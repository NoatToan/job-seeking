"""Contributor feature wired into job-seeking (`/api/feedback`, admin role, `/api/me` role, export
and account deletion) against a real throwaway-schema Postgres. Skipped without
`TEST_DATABASE_URL` (see conftest.py). The endpoint rules themselves are covered DB-free by the
vendored `test_cb_*.py`; this file proves the host wiring: session auth, CSRF, admin sources,
error shape and the body limit."""

import base64

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.admin import list_admins, set_role
from ujc_api.main import create_app
from ujc_api.settings import Settings

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
ENV_ADMIN = "boss@example.com"


def _client(migrated_database_url: str) -> TestClient:
    settings = Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
        ujc_admin_emails=f" {ENV_ADMIN.upper()} , other-admin@example.com",
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


def _create(client: TestClient, csrf: dict[str, str], **overrides) -> dict:
    body = {
        "kind": "bug",
        "title": "Tracker card overlaps",
        "pageUrl": "https://jobs.example.com/tracker/?view=board",
        "elementSelector": "main > div:nth-of-type(2)",
        "screenshot": "data:image/jpeg;base64," + base64.b64encode(JPEG).decode(),
        **overrides,
    }
    resp = client.post("/api/feedback", json=body, headers=csrf)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_me_reports_role_from_env_list_and_column(make_client, migrated_database_url: str):
    user = make_client()
    _sign_in(user, "plain-user@example.com")
    assert user.get("/api/me").json()["user"]["role"] == "user"

    env_admin = make_client()
    _sign_in(env_admin, ENV_ADMIN)
    assert env_admin.get("/api/me").json()["user"]["role"] == "admin"

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        assert set_role(conn, "Plain-User@example.com ", "admin") is True
        assert "plain-user@example.com" in list_admins(conn)
        assert set_role(conn, "nobody@example.com", "admin") is False
    assert user.get("/api/me").json()["user"]["role"] == "admin"
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        set_role(conn, "plain-user@example.com", "user")
    assert user.get("/api/me").json()["user"]["role"] == "user"


def test_full_flow_through_host_auth(make_client):
    author = make_client()
    author_csrf = _sign_in(author, "author@example.com")
    other = make_client()
    other_csrf = _sign_in(other, "voter@example.com")
    admin = make_client()
    # The second listed admin: the OTP flow allows one code per email per minute.
    admin_csrf = _sign_in(admin, "other-admin@example.com")

    item = _create(author, author_csrf)
    item_id = item["id"]
    assert item["context"]["hasScreenshot"] is True

    # Public on arrival (contributor-box DECISIONS 16), without context, with the email's local
    # part as the byline (never the email).
    seen_new = other.get(f"/api/feedback/{item_id}").json()
    assert seen_new["context"] is None and seen_new["author"] is None
    assert seen_new["byline"]["name"] == "author"
    assert "example.com" not in str(seen_new["byline"])

    # Rejected = off the board; 404 in the host's error shape.
    rejected = admin.patch(
        f"/api/feedback/{item_id}", json={"status": "rejected"}, headers=admin_csrf
    )
    assert rejected.status_code == 200, rejected.text
    hidden = other.get(f"/api/feedback/{item_id}")
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "not_found"

    # Admin-only actions: 403 for a plain user, CSRF enforced, then allowed for the admin.
    denied = other.patch(
        f"/api/feedback/{item_id}", json={"status": "approved"}, headers=other_csrf
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"
    no_csrf = admin.patch(f"/api/feedback/{item_id}", json={"status": "approved"})
    assert no_csrf.status_code == 403
    assert no_csrf.json()["error"]["code"] == "csrf_failed"
    approved = admin.patch(
        f"/api/feedback/{item_id}",
        json={"status": "approved", "adminResponse": "Good catch"},
        headers=admin_csrf,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["author"]["email"] == "author@example.com"
    assert other.get("/api/feedback?scope=all").status_code == 403
    assert admin.get("/api/feedback?scope=all").json()["total"] >= 1

    # Public now: others see it without context and can vote.
    seen = other.get(f"/api/feedback/{item_id}").json()
    assert seen["context"] is None and seen["adminResponse"] == "Good catch"
    voted = other.put(f"/api/feedback/{item_id}/vote", headers=other_csrf)
    assert voted.json()["score"] == 1
    down = other.put(f"/api/feedback/{item_id}/vote", json={"value": -1}, headers=other_csrf)
    assert down.json()["score"] == -1 and down.json()["myVote"] == -1
    assert other.get(f"/api/feedback/{item_id}/screenshot").status_code == 404

    shot = author.get(f"/api/feedback/{item_id}/screenshot")
    assert shot.status_code == 200
    assert shot.content == JPEG
    assert shot.headers["content-type"] == "image/jpeg"

    # Validation errors use the host's 400 shape.
    bad = author.post(
        "/api/feedback",
        json={"kind": "bug", "title": "x", "pageUrl": "javascript:alert(1)"},
        headers=author_csrf,
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "validation_error"


def test_anonymous_feedback_through_host_csrf(make_client, migrated_database_url: str):
    guest = make_client()
    idea = {"kind": "idea", "title": "Dark mode please", "authorName": "  Minh "}
    # No CSRF cookie yet: refused, then the visitor fetches one without signing in.
    assert guest.post("/api/feedback", json=idea).json()["error"]["code"] == "csrf_failed"
    assert guest.get("/api/auth/csrf").status_code == 204
    csrf = {"X-CSRF-Token": guest.cookies.get("ujc_csrf") or ""}
    resp = guest.post("/api/feedback", json=idea, headers=csrf)
    assert resp.status_code == 201, resp.text
    item = resp.json()
    # The visitor cookie (issued on this request) makes it theirs, without an account; the typed
    # name became their display name.
    assert item["isMine"] is True and item["context"] is None and item["author"] is None
    assert item["byline"]["name"] == "Minh" and item["byline"]["kind"] == "guest"
    assert guest.cookies.get("cb_visitor")

    # New items are on the public board, so the guest reads it back; still no "my feedback".
    again = guest.get(f"/api/feedback/{item['id']}")
    assert again.status_code == 200 and again.json()["isMine"] is True
    assert guest.get("/api/feedback?scope=mine").status_code == 401

    admin = make_client()
    admin_csrf = _sign_in(admin, "anon-reviewer@example.com")
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        assert set_role(conn, "anon-reviewer@example.com", "admin") is True
    seen = admin.get(f"/api/feedback/{item['id']}").json()
    author = seen["author"]
    assert author["id"] is None and author["email"] is None and author["anonymous"] is True
    assert author["name"].startswith("Minh (")  # "Minh (Brave Otter #123)"

    # Public board (the /roadmap/ page): once approved, guests read it without signing in, with
    # public fields only, and still cannot vote.
    before = guest.get("/api/feedback/stats").json()
    approved = admin.patch(
        f"/api/feedback/{item['id']}",
        json={"status": "approved", "adminResponse": "Good idea"},
        headers=admin_csrf,
    )
    assert approved.status_code == 200, approved.text
    after = guest.get("/api/feedback/stats").json()
    assert after["counts"]["approved"] == before["counts"]["approved"] + 1
    assert after["counts"]["new"] == before["counts"]["new"] - 1
    assert after["total"] == before["total"]  # it was already public while new
    board = guest.get("/api/feedback?scope=board&status=approved&sort=top&limit=50")
    assert board.status_code == 200, board.text
    listed = next(i for i in board.json()["items"] if i["id"] == item["id"])
    assert listed["canVote"] is False and listed["myVote"] == 0 and listed["author"] is None
    detail = guest.get(f"/api/feedback/{item['id']}").json()
    assert detail["adminResponse"] == "Good idea" and detail["context"] is None
    assert guest.put(f"/api/feedback/{item['id']}/vote", headers=csrf).status_code == 401

    # Signed-in users keep their account as the author; a sent name is ignored.
    user = make_client()
    user_csrf = _sign_in(user, "named-user@example.com")
    mine = _create(user, user_csrf, authorName="Someone else")
    assert mine["isMine"] is True
    assert admin.get(f"/api/feedback/{mine['id']}").json()["author"]["name"] is None


def test_body_limit_allows_screenshot_sized_feedback_but_not_more(make_client):
    client = make_client()
    csrf = _sign_in(client, "big@example.com")
    near_limit = b"\xff\xd8\xff\xe0" + b"\x00" * 1_400_000
    ok = client.post(
        "/api/feedback",
        json={
            "kind": "bug",
            "title": "Big screenshot",
            "screenshot": "data:image/jpeg;base64," + base64.b64encode(near_limit).decode(),
        },
        headers=csrf,
    )
    assert ok.status_code == 201, ok.text[:200]
    too_big = client.post(
        "/api/feedback",
        content=b"{" + b" " * 2_300_000 + b"}",
        headers={**csrf, "Content-Type": "application/json"},
    )
    assert too_big.status_code == 413
    # Other routes keep the 1 MB default.
    other = client.put(
        "/api/me/preferences",
        content=b"{" + b" " * 1_100_000 + b"}",
        headers={**csrf, "Content-Type": "application/json"},
    )
    assert other.status_code == 413


def test_export_and_account_deletion_cover_feedback(make_client, migrated_database_url: str):
    client = make_client()
    csrf = _sign_in(client, "leaver@example.com")
    item = _create(client, csrf, title="Please add dark mode", kind="idea", screenshot=None)
    exported = client.get("/api/me/export").json()
    assert [f["title"] for f in exported["feedback"]] == ["Please add dark mode"]

    resp = client.request("DELETE", "/api/me", json={"confirm": "DELETE"}, headers=csrf)
    assert resp.status_code == 204
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        left = conn.execute(
            "SELECT count(*) FROM feedback_items WHERE id = %s", (int(item["id"]),)
        ).fetchone()
    assert left == (0,)
