"""Feedback comments, votes and pseudonymous guests through job-seeking's wiring (session auth,
the `ujc_csrf` double-submit cookie, the `cb_visitor` cookie signed with `UJC_SECRET_KEY`, the
admin role, migration 025) against a real throwaway-schema Postgres. Skipped without
`TEST_DATABASE_URL`. The endpoint rules themselves are covered DB-free by the vendored
`test_cb_comments.py`."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.admin import set_role
from ujc_api.main import create_app
from ujc_api.settings import Settings


def _client(migrated_database_url: str) -> TestClient:
    settings = Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="comments-db-secret",
        ujc_otp_review_mode=True,
    )
    return TestClient(create_app(settings), base_url="https://testserver")


@pytest.fixture
def make_client(migrated_database_url: str):
    clients: list[TestClient] = []

    def factory() -> TestClient:
        c = _client(migrated_database_url)
        c.__enter__()
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


def _sign_in(client: TestClient, email: str) -> dict[str, str]:
    code = client.post("/api/auth/otp", json={"email": email}).json()["devCode"]
    resp = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert resp.status_code == 200, resp.text
    return {"X-CSRF-Token": client.cookies.get("ujc_csrf") or ""}


def _guest(make_client, ip: str) -> tuple[TestClient, dict[str, str]]:
    guest = make_client()
    assert guest.get("/api/auth/csrf").status_code == 204
    return guest, {"X-CSRF-Token": guest.cookies.get("ujc_csrf") or "", "X-Forwarded-For": ip}


def test_guest_and_member_conversation(make_client, migrated_database_url: str):
    author = make_client()
    author_csrf = _sign_in(author, "idea-author@example.com")
    item = author.post(
        "/api/feedback", json={"kind": "idea", "title": "Salary in VND"}, headers=author_csrf
    ).json()
    item_id = item["id"]

    # A guest learns who they will appear as; this issues the signed visitor cookie.
    guest, guest_headers = _guest(make_client, "198.51.100.20")
    me = guest.get("/api/feedback/identity")
    assert me.status_code == 200
    ident = me.json()
    assert ident["kind"] == "guest" and ident["pseudonym"]["en"] and ident["pseudonym"]["vi"]
    set_cookie = me.headers["set-cookie"].lower()
    assert "cb_visitor=" in set_cookie and "httponly" in set_cookie and "secure" in set_cookie
    raw = guest.cookies.get("cb_visitor") or ""
    assert raw.startswith("v1.")

    # Without the CSRF token: refused, like every unsafe call.
    no_csrf = guest.post(f"/api/feedback/{item_id}/comments", json={"body": "hi"})
    assert no_csrf.json()["error"]["code"] == "csrf_failed"

    posted = guest.post(
        f"/api/feedback/{item_id}/comments",
        json={"body": "Would love this, see https://example.com"},
        headers=guest_headers,
    )
    assert posted.status_code == 201, posted.text
    comment = posted.json()
    assert comment["author"]["pseudonym"] == ident["pseudonym"]
    assert comment["isMine"] is True and comment["canVote"] is False

    # A member replies; replying to the guest's reply-less comment makes a thread.
    member = make_client()
    member_csrf = _sign_in(member, "jane.doe@example.com")
    reply = member.post(
        f"/api/feedback/{item_id}/comments",
        json={"body": f"@{ident['pseudonym']['en']} +1", "parentId": comment["id"]},
        headers=member_csrf,
    ).json()
    assert reply["parentId"] == comment["id"]
    assert reply["author"]["name"] == "jane.doe"  # local part only
    assert "example.com" not in str(reply["author"])

    # Votes: members only, up/down, not on your own comment.
    vote_path = f"/api/feedback/{item_id}/comments/{comment['id']}/vote"
    assert guest.put(vote_path, json={"value": 1}, headers=guest_headers).status_code == 401
    up = member.put(vote_path, json={"value": 1}, headers=member_csrf).json()
    assert up["score"] == 1 and up["myVote"] == 1
    down = member.put(vote_path, json={"value": -1}, headers=member_csrf).json()
    assert down["score"] == -1
    own = member.put(f"/api/feedback/{item_id}/comments/{reply['id']}/vote", headers=member_csrf)
    assert own.status_code == 409

    # The guest picks a name; it shows on their existing comment, signed out.
    named = guest.put("/api/feedback/identity", json={"displayName": "Lan"}, headers=guest_headers)
    assert named.status_code == 200 and named.json()["name"] == "Lan"
    reserved = guest.put(
        "/api/feedback/identity", json={"displayName": "Admin"}, headers=guest_headers
    )
    assert reserved.status_code == 400
    assert reserved.json()["error"]["code"] == "validation_error"
    reader = make_client()
    thread = reader.get(f"/api/feedback/{item_id}/comments").json()
    assert thread["total"] == 1 and thread["canComment"] is True
    [top] = thread["comments"]
    assert top["author"]["name"] == "Lan" and top["replies"][0]["body"].endswith("+1")
    assert top["isMine"] is False  # a different browser
    board = reader.get("/api/feedback?scope=board&status=approved&limit=50").json()
    listed = next(i for i in board["items"] if i["id"] == item_id)
    assert listed["commentCount"] == 2

    # Nothing secret in responses: the cookie's id never appears.
    visitor_id = raw.split(".")[1]
    assert visitor_id not in str(thread) and visitor_id not in str(ident)
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        stored = conn.execute(
            "SELECT visitor_key, anon_key FROM feedback_comments WHERE id = %s",
            (int(comment["id"]),),
        ).fetchone()
    assert stored is not None
    assert visitor_id not in stored[0] and "198.51.100.20" not in (stored[1] or "")


def test_moderation_lock_and_reports(make_client, migrated_database_url: str):
    author = make_client()
    author_csrf = _sign_in(author, "mod-author@example.com")
    item_id = author.post(
        "/api/feedback", json={"kind": "bug", "title": "Search is slow"}, headers=author_csrf
    ).json()["id"]
    troll = make_client()
    troll_csrf = _sign_in(troll, "troll@example.com")
    bad = troll.post(
        f"/api/feedback/{item_id}/comments", json={"body": "spam spam"}, headers=troll_csrf
    ).json()

    guest, guest_headers = _guest(make_client, "198.51.100.30")
    report = guest.post(
        f"/api/feedback/{item_id}/comments/{bad['id']}/report",
        json={"reason": "Spam"},
        headers=guest_headers,
    )
    assert report.status_code == 200, report.text

    admin = make_client()
    admin_csrf = _sign_in(admin, "comment-mod@example.com")
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        assert set_role(conn, "comment-mod@example.com", "admin") is True
    assert troll.get("/api/feedback/comments/reported").status_code == 403
    queue = admin.get("/api/feedback/comments/reported").json()
    entry = next(c for c in queue["comments"] if c["id"] == bad["id"])
    assert entry["reportCount"] == 1 and entry["reasons"] == ["Spam"]

    hidden = admin.put(f"/api/feedback/{item_id}/comments/{bad['id']}/hidden", headers=admin_csrf)
    assert hidden.status_code == 200 and hidden.json()["hidden"] is True
    assert guest.get(f"/api/feedback/{item_id}/comments").json()["comments"] == []

    locked = admin.patch(
        f"/api/feedback/{item_id}", json={"commentsLocked": True}, headers=admin_csrf
    )
    assert locked.json()["commentsLocked"] is True
    blocked = author.post(
        f"/api/feedback/{item_id}/comments", json={"body": "more info"}, headers=author_csrf
    )
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "comments_locked"
    team = admin.post(
        f"/api/feedback/{item_id}/comments", json={"body": "Tracking this."}, headers=admin_csrf
    ).json()
    assert team["author"]["team"] is True


def test_account_deletion_keeps_threads_and_export_has_comments(make_client):
    author = make_client()
    author_csrf = _sign_in(author, "thread-author@example.com")
    item_id = author.post(
        "/api/feedback", json={"kind": "idea", "title": "CSV export"}, headers=author_csrf
    ).json()["id"]
    leaver = make_client()
    leaver_csrf = _sign_in(leaver, "comment-leaver@example.com")
    mine = leaver.post(
        f"/api/feedback/{item_id}/comments", json={"body": "my words"}, headers=leaver_csrf
    ).json()
    author.post(
        f"/api/feedback/{item_id}/comments",
        json={"body": "a reply", "parentId": mine["id"]},
        headers=author_csrf,
    )
    leaver.put("/api/feedback/identity", json={"displayName": "Leaver"}, headers=leaver_csrf)

    exported = leaver.get("/api/me/export").json()
    assert [c["body"] for c in exported["feedbackComments"]] == ["my words"]
    assert exported["feedbackDisplayName"] == "Leaver"

    resp = leaver.request("DELETE", "/api/me", json={"confirm": "DELETE"}, headers=leaver_csrf)
    assert resp.status_code == 204
    [top] = author.get(f"/api/feedback/{item_id}/comments").json()["comments"]
    assert top["deleted"] is True and top["body"] is None and top["author"] is None
    assert top["replies"][0]["body"] == "a reply"


def test_migration_025_vote_values(migrated_database_url: str):
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        default = conn.execute(
            "SELECT column_default, is_nullable FROM information_schema.columns"
            " WHERE table_name = 'feedback_votes' AND column_name = 'value'"
            " AND table_schema = current_schema()"
        ).fetchone()
    assert default == (None, "NO")
