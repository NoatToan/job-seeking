"""Comment, identity and report endpoints against the in-memory repository (no database).

User 1 is the admin, user 2 the item author, user 3 and 4 other signed-in users. Anonymous
visitors are TestClients without `X-User`, identified by their `cb_visitor` cookie.
"""

from datetime import timedelta

import pytest
from cb_fakes import CSRF, InMemoryFeedbackRepository, as_user, build_app
from fastapi.testclient import TestClient

from contributor_box.constants import (
    COMMENT_DELETE_WINDOW_SECONDS,
    COMMENT_EDIT_WINDOW_SECONDS,
    MAX_ANON_COMMENTS_PER_HOUR,
    MAX_ANON_COMMENTS_PER_HOUR_TOTAL,
    MAX_ANON_COMMENTS_PER_IP_PER_HOUR,
    MAX_COMMENTS_PER_HOUR,
    REPLIES_PREVIEW,
)
from contributor_box.identity import pseudonym

ADMIN, AUTHOR, OTHER, FOURTH = 1, 2, 3, 4


@pytest.fixture
def repo() -> InMemoryFeedbackRepository:
    return InMemoryFeedbackRepository()


@pytest.fixture
def app(repo):
    return build_app(repo, allow_anonymous=True, public_board=True, allow_anonymous_comments=True)


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


def guest(app, ip: str = "203.0.113.7") -> TestClient:
    """A fresh anonymous browser (own cookie jar) behind `ip`."""
    c = TestClient(app)
    c.headers.update({"X-CSRF-Token": CSRF, "X-Forwarded-For": ip})
    return c


def new_item(client: TestClient, user: int = AUTHOR, status: str | None = None) -> str:
    resp = client.post(
        "/api/feedback", json={"kind": "idea", "title": "Dark mode"}, headers=as_user(client, user)
    )
    assert resp.status_code == 201, resp.text
    item_id = resp.json()["id"]
    if status:
        patch = client.patch(
            f"/api/feedback/{item_id}", json={"status": status}, headers=as_user(client, ADMIN)
        )
        assert patch.status_code == 200
    return item_id


def comment(
    client: TestClient, item_id: str, body: str = "Great idea", user: int | None = OTHER, **extra
):
    headers = as_user(client, user) if user is not None else {}
    return client.post(
        f"/api/feedback/{item_id}/comments", json={"body": body, **extra}, headers=headers
    )


def thread(client: TestClient, item_id: str, user: int | None = OTHER, **params) -> dict:
    headers = as_user(client, user, csrf=False) if user is not None else {}
    resp = client.get(f"/api/feedback/{item_id}/comments", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- reading and writing ---------------------------------------------------------------------


def test_signed_in_comment_and_two_level_replies(client: TestClient):
    item_id = new_item(client)
    top = comment(client, item_id, "Yes please").json()
    assert top["parentId"] is None and top["replies"] == [] and top["replyCount"] == 0
    assert top["author"]["name"] == "user3" and top["author"]["kind"] == "user"
    assert top["isMine"] and top["canEdit"] and top["canDelete"] and not top["canVote"]
    reply = comment(client, item_id, "Agreed", user=FOURTH, parentId=top["id"]).json()
    assert reply["parentId"] == top["id"]
    # A reply to a reply joins the same top-level thread.
    nested = comment(client, item_id, "@user4 me too", user=AUTHOR, parentId=reply["id"]).json()
    assert nested["parentId"] == top["id"]

    page = thread(client, item_id)
    assert page["total"] == 1 and page["canComment"] is True and page["locked"] is False
    [only] = page["comments"]
    assert only["replyCount"] == 2
    assert [r["body"] for r in only["replies"]] == ["Agreed", "@user4 me too"]
    item = client.get(f"/api/feedback/{item_id}", headers=as_user(client, OTHER)).json()
    assert item["commentCount"] == 3


def test_admin_comments_carry_the_team_badge(client: TestClient):
    item_id = new_item(client)
    mine = comment(client, item_id, "We're on it", user=ADMIN).json()
    assert mine["author"]["team"] is True
    assert comment(client, item_id).json()["author"]["team"] is False


def test_top_level_sorted_by_score_then_newest_and_replies_oldest_first(client: TestClient):
    item_id = new_item(client)
    first = comment(client, item_id, "first").json()
    comment(client, item_id, "second")
    third = comment(client, item_id, "third").json()
    client.put(
        f"/api/feedback/{item_id}/comments/{first['id']}/vote", headers=as_user(client, FOURTH)
    )
    page = thread(client, item_id)
    assert [c["body"] for c in page["comments"]] == ["first", "third", "second"]
    for n in range(REPLIES_PREVIEW + 2):
        comment(client, item_id, f"reply {n}", user=FOURTH, parentId=third["id"])
    page = thread(client, item_id, limit=1, offset=1)
    [shown] = page["comments"]
    assert shown["id"] == third["id"] and page["total"] == 3
    assert shown["replyCount"] == REPLIES_PREVIEW + 2
    assert [r["body"] for r in shown["replies"]] == [f"reply {n}" for n in range(REPLIES_PREVIEW)]
    more = client.get(
        f"/api/feedback/{item_id}/comments/{third['id']}/replies",
        params={"offset": REPLIES_PREVIEW},
    ).json()
    assert more["total"] == REPLIES_PREVIEW + 2
    assert [r["body"] for r in more["replies"]] == ["reply 3", "reply 4"]
    # Replies of a reply do not exist.
    reply_id = shown["replies"][0]["id"]
    assert client.get(f"/api/feedback/{item_id}/comments/{reply_id}/replies").status_code == 404


def test_comments_on_rejected_items_are_author_and_admin_only(client: TestClient):
    item_id = new_item(client, status="rejected")
    assert comment(client, item_id, user=OTHER).status_code == 404
    assert comment(client, item_id, user=AUTHOR).status_code == 201
    assert comment(client, item_id, user=ADMIN).status_code == 201
    other = client.get(f"/api/feedback/{item_id}/comments", headers=as_user(client, OTHER))
    assert other.status_code == 404
    assert client.get(f"/api/feedback/{item_id}/comments").status_code == 404
    assert thread(client, item_id, user=AUTHOR)["total"] == 2


def test_validation_and_unknown_parent(client: TestClient):
    item_id = new_item(client)
    other_item = new_item(client)
    assert comment(client, item_id, "   ").status_code == 422
    assert comment(client, item_id, "x" * 2001).status_code == 422
    foreign = comment(client, other_item).json()
    assert comment(client, item_id, parentId=foreign["id"]).status_code == 404
    assert comment(client, item_id, parentId="999").status_code == 404
    assert client.get("/api/feedback/999/comments").status_code == 404


def test_writes_need_csrf(client: TestClient):
    item_id = new_item(client)
    resp = client.post(
        f"/api/feedback/{item_id}/comments",
        json={"body": "hi"},
        headers=as_user(client, OTHER, csrf=False),
    )
    assert resp.status_code == 403


# --- edit and delete -------------------------------------------------------------------------


def test_edit_own_comment_within_the_window(client: TestClient, repo):
    item_id = new_item(client)
    mine = comment(client, item_id, "typo").json()
    path = f"/api/feedback/{item_id}/comments/{mine['id']}"
    edited = client.patch(path, json={"body": "fixed"}, headers=as_user(client, OTHER))
    assert edited.status_code == 200 and edited.json()["body"] == "fixed"
    assert edited.json()["editedAt"] is not None
    assert (
        client.patch(path, json={"body": "x"}, headers=as_user(client, FOURTH)).status_code == 403
    )
    # Admins moderate, they do not rewrite people's words.
    assert client.patch(path, json={"body": "x"}, headers=as_user(client, ADMIN)).status_code == 403
    repo.clock_offset = -timedelta(seconds=COMMENT_EDIT_WINDOW_SECONDS + 5)
    old = comment(client, item_id, "old").json()
    repo.clock_offset = timedelta(0)
    late = client.patch(
        f"/api/feedback/{item_id}/comments/{old['id']}",
        json={"body": "too late"},
        headers=as_user(client, OTHER),
    )
    assert late.status_code == 403
    assert old["canEdit"] is False


def test_delete_hard_without_replies_soft_with_replies(client: TestClient, repo):
    item_id = new_item(client)
    lonely = comment(client, item_id, "lonely").json()
    resp = client.delete(
        f"/api/feedback/{item_id}/comments/{lonely['id']}", headers=as_user(client, OTHER)
    )
    assert resp.json() == {"result": "hard", "comment": None}

    top = comment(client, item_id, "parent").json()
    reply = comment(client, item_id, "child", user=FOURTH, parentId=top["id"]).json()
    resp = client.delete(
        f"/api/feedback/{item_id}/comments/{top['id']}", headers=as_user(client, OTHER)
    ).json()
    assert resp["result"] == "soft"
    placeholder = resp["comment"]
    assert placeholder["deleted"] is True and placeholder["body"] is None
    assert placeholder["author"] is None and placeholder["canReply"] is False
    [shown] = thread(client, item_id)["comments"]
    assert shown["deleted"] and shown["replies"][0]["body"] == "child"
    # No new replies under a deleted comment directly...
    assert comment(client, item_id, "x", parentId=top["id"]).status_code == 409
    # ...and once the last reply goes, so does the placeholder.
    client.delete(
        f"/api/feedback/{item_id}/comments/{reply['id']}", headers=as_user(client, FOURTH)
    )
    assert thread(client, item_id)["comments"] == []
    assert repo.comments == {}


def test_delete_window_and_admin_override(client: TestClient, repo):
    item_id = new_item(client)
    repo.clock_offset = -timedelta(seconds=COMMENT_DELETE_WINDOW_SECONDS + 5)
    old = comment(client, item_id, "old").json()
    repo.clock_offset = timedelta(0)
    path = f"/api/feedback/{item_id}/comments/{old['id']}"
    assert client.delete(path, headers=as_user(client, OTHER)).status_code == 403
    assert client.delete(path, headers=as_user(client, FOURTH)).status_code == 403
    assert client.delete(path, headers=as_user(client, ADMIN)).json()["result"] == "hard"


# --- moderation ------------------------------------------------------------------------------


def test_admin_hides_and_unhides(client: TestClient):
    item_id = new_item(client)
    bad = comment(client, item_id, "rude").json()
    path = f"/api/feedback/{item_id}/comments/{bad['id']}/hidden"
    assert client.put(path, headers=as_user(client, OTHER)).status_code == 403
    hidden = client.put(path, headers=as_user(client, ADMIN)).json()
    assert hidden["hidden"] is True and hidden["body"] == "rude"
    assert thread(client, item_id)["comments"] == []  # gone for everyone else
    as_admin = thread(client, item_id, user=ADMIN)["comments"]
    assert as_admin[0]["hidden"] is True and as_admin[0]["body"] == "rude"
    item = client.get(f"/api/feedback/{item_id}", headers=as_user(client, OTHER)).json()
    assert item["commentCount"] == 0
    # The author cannot edit or vote on it; nobody else can reach it.
    edit = client.patch(
        f"/api/feedback/{item_id}/comments/{bad['id']}",
        json={"body": "sorry"},
        headers=as_user(client, OTHER),
    )
    assert edit.status_code == 404
    client.delete(path, headers=as_user(client, ADMIN))
    assert thread(client, item_id)["comments"][0]["body"] == "rude"


def test_hidden_parent_with_replies_shows_a_placeholder(client: TestClient):
    item_id = new_item(client)
    top = comment(client, item_id, "spam link").json()
    comment(client, item_id, "reply", user=FOURTH, parentId=top["id"])
    client.put(
        f"/api/feedback/{item_id}/comments/{top['id']}/hidden", headers=as_user(client, ADMIN)
    )
    [shown] = thread(client, item_id)["comments"]
    assert shown["hidden"] is True and shown["body"] is None and shown["author"] is None
    assert shown["replies"][0]["body"] == "reply"


def test_lock_comments(client: TestClient):
    item_id = new_item(client)
    lock = client.patch(
        f"/api/feedback/{item_id}", json={"commentsLocked": True}, headers=as_user(client, ADMIN)
    )
    assert lock.status_code == 200 and lock.json()["commentsLocked"] is True
    resp = comment(client, item_id)
    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "comments_locked"
    assert thread(client, item_id)["canComment"] is False
    assert comment(client, item_id, "Locked: duplicate of #2", user=ADMIN).status_code == 201
    assert thread(client, item_id)["comments"][0]["canReply"] is False
    denied = client.patch(
        f"/api/feedback/{item_id}", json={"commentsLocked": False}, headers=as_user(client, OTHER)
    )
    assert denied.status_code == 403


# --- votes on comments -----------------------------------------------------------------------


def test_comment_votes(client: TestClient, app):
    item_id = new_item(client)
    c = comment(client, item_id).json()
    path = f"/api/feedback/{item_id}/comments/{c['id']}/vote"
    assert client.put(path, headers=as_user(client, OTHER)).status_code == 409  # own comment
    up = client.put(path, json={"value": 1}, headers=as_user(client, FOURTH)).json()
    assert (up["score"], up["myVote"]) == (1, 1)
    down = client.put(path, json={"value": -1}, headers=as_user(client, FOURTH)).json()
    assert (down["score"], down["upvotes"], down["downvotes"]) == (-1, 0, 1)
    cleared = client.delete(path, headers=as_user(client, FOURTH)).json()
    assert (cleared["score"], cleared["myVote"]) == (0, 0)
    # Signed out: never, even with anonymous comments on.
    g = guest(app)
    assert g.put(path).status_code == 401
    assert g.delete(path).status_code == 401


# --- anonymous visitors ----------------------------------------------------------------------


def test_anonymous_comments_are_off_by_default(repo):
    client = TestClient(build_app(repo, public_board=True))
    item_id = new_item(client)
    resp = client.post(
        f"/api/feedback/{item_id}/comments", json={"body": "hi"}, headers={"X-CSRF-Token": CSRF}
    )
    assert resp.status_code == 401
    # Reading still works signed out with the public board.
    assert client.get(f"/api/feedback/{item_id}/comments").status_code == 200
    assert client.get("/api/feedback/identity").status_code == 401


def test_anonymous_comments_require_config():
    from contributor_box.router import FeedbackDeps, create_feedback_router

    deps = FeedbackDeps(
        current_user=lambda: None,
        viewer_is_admin=lambda: False,
        get_repo=lambda: None,
        require_csrf=lambda: None,
        optional_user=lambda: None,
        optional_viewer_is_admin=lambda: False,
        anonymous_key=lambda: "k",
    )
    with pytest.raises(ValueError):
        create_feedback_router(deps, public_board=True, allow_anonymous_comments=True)
    with pytest.raises(ValueError):
        create_feedback_router(deps, allow_anonymous_comments=True)


def test_guest_identity_comment_and_reply(client: TestClient, app, repo):
    item_id = new_item(client)
    g = guest(app)
    me = g.get("/api/feedback/identity")
    assert me.status_code == 200 and me.headers["cache-control"] == "private, no-store"
    ident = me.json()
    assert ident["kind"] == "guest" and ident["name"] is None
    raw_cookie = g.cookies.get("cb_visitor")
    assert raw_cookie
    first = g.post(f"/api/feedback/{item_id}/comments", json={"body": "From a guest"})
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["author"]["kind"] == "guest"
    assert body["author"]["pseudonym"] == ident["pseudonym"]
    assert body["author"]["tag"] == ident["tag"] and body["isMine"] is True
    assert body["canVote"] is False and body["canEdit"] is True
    # Same name on every comment from this browser.
    reply = g.post(
        f"/api/feedback/{item_id}/comments", json={"body": "and a reply", "parentId": body["id"]}
    ).json()
    assert reply["author"]["pseudonym"] == ident["pseudonym"]
    # Nothing secret leaves the server: no cookie id, no visitor key.
    stored_key = next(iter(repo.comments.values()))["visitor_key"]
    assert pseudonym(stored_key).en == ident["pseudonym"]["en"]
    for text in (str(ident), str(body), str(thread(client, item_id, user=None))):
        assert stored_key not in text and raw_cookie.split(".")[1] not in text
    # Another browser sees it as someone else's.
    other = guest(app, "198.51.100.9")
    seen = thread(other, item_id, user=None)["comments"][0]
    assert seen["isMine"] is False and seen["canEdit"] is False and seen["canReport"] is True


def test_guest_sets_a_display_name(client: TestClient, app):
    item_id = new_item(client)
    g = guest(app)
    g.post(f"/api/feedback/{item_id}/comments", json={"body": "hello"})
    named = g.put("/api/feedback/identity", json={"displayName": "  Minh  "})
    assert named.status_code == 200 and named.json()["name"] == "Minh"
    assert thread(client, item_id)["comments"][0]["author"]["name"] == "Minh"
    reserved = g.put("/api/feedback/identity", json={"displayName": "Moderator"})
    assert reserved.status_code == 422
    cleared = g.put("/api/feedback/identity", json={"displayName": None}).json()
    assert cleared["name"] is None and cleared["pseudonym"]
    # CSRF still applies.
    no_csrf = TestClient(app)
    no_csrf.cookies.set("cb_visitor", g.cookies.get("cb_visitor") or "")
    assert no_csrf.put("/api/feedback/identity", json={"displayName": "X"}).status_code == 403


def test_signed_in_identity(client: TestClient):
    me = client.get("/api/feedback/identity", headers=as_user(client, OTHER)).json()
    assert me == {
        "kind": "user",
        "name": "user3",
        "customName": None,
        "pseudonym": None,
        "tag": None,
        "avatar": me["avatar"],
        "team": False,
    }
    named = client.put(
        "/api/feedback/identity", json={"displayName": "Jane"}, headers=as_user(client, OTHER)
    ).json()
    assert named["name"] == "Jane" and named["customName"] == "Jane"
    admin = client.get("/api/feedback/identity", headers=as_user(client, ADMIN)).json()
    assert admin["team"] is True
    assert (
        "set-cookie"
        not in client.get("/api/feedback/identity", headers=as_user(client, OTHER)).headers
    )


def test_guest_edits_and_deletes_own_comment_by_cookie(client: TestClient, app):
    item_id = new_item(client)
    g = guest(app)
    mine = g.post(f"/api/feedback/{item_id}/comments", json={"body": "typo"}).json()
    path = f"/api/feedback/{item_id}/comments/{mine['id']}"
    assert g.patch(path, json={"body": "fixed"}).json()["body"] == "fixed"
    stranger = guest(app, "198.51.100.2")
    stranger.get("/api/feedback/identity")  # has a cookie, but not this one
    assert stranger.patch(path, json={"body": "hijack"}).status_code == 403
    assert stranger.delete(path).status_code == 403
    cookieless = guest(app, "198.51.100.3")
    assert cookieless.delete(path).status_code == 401
    assert g.delete(path).json()["result"] == "hard"


def test_guest_cannot_comment_on_hidden_items_or_locked_ones(client: TestClient, app):
    rejected = new_item(client, status="rejected")
    g = guest(app)
    assert g.post(f"/api/feedback/{rejected}/comments", json={"body": "x"}).status_code == 404
    locked = new_item(client)
    client.patch(
        f"/api/feedback/{locked}", json={"commentsLocked": True}, headers=as_user(client, ADMIN)
    )
    assert g.post(f"/api/feedback/{locked}/comments", json={"body": "x"}).status_code == 409


def test_honeypot_and_csrf(client: TestClient, app, repo):
    item_id = new_item(client)
    g = guest(app)
    bot = g.post(f"/api/feedback/{item_id}/comments", json={"body": "buy", "website": "x.com"})
    assert bot.status_code == 400 and bot.json()["detail"]["code"] == "spam_detected"
    assert repo.comments == {}
    no_csrf = TestClient(app)
    resp = no_csrf.post(f"/api/feedback/{item_id}/comments", json={"body": "hi"})
    assert resp.status_code == 403


def test_guest_rate_limits_per_visitor_per_ip_and_global(client: TestClient, app):
    item_id = new_item(client)
    g = guest(app)
    for _ in range(MAX_ANON_COMMENTS_PER_HOUR):
        assert g.post(f"/api/feedback/{item_id}/comments", json={"body": "hi"}).status_code == 201
    limited = g.post(f"/api/feedback/{item_id}/comments", json={"body": "hi"})
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "3600"
    # Dropping the cookie does not escape the per-IP limit.
    remaining_for_ip = MAX_ANON_COMMENTS_PER_IP_PER_HOUR - MAX_ANON_COMMENTS_PER_HOUR
    for _ in range(remaining_for_ip):
        fresh = guest(app)
        assert (
            fresh.post(f"/api/feedback/{item_id}/comments", json={"body": "hi"}).status_code == 201
        )
    assert (
        guest(app).post(f"/api/feedback/{item_id}/comments", json={"body": "hi"}).status_code == 429
    )
    # Signed-in users are not affected by the anonymous caps.
    assert comment(client, item_id).status_code == 201


def test_guest_global_cap(client: TestClient, app):
    item_id = new_item(client)
    for n in range(MAX_ANON_COMMENTS_PER_HOUR_TOTAL):
        resp = guest(app, f"10.2.{n}.1").post(
            f"/api/feedback/{item_id}/comments", json={"body": "hi"}
        )
        assert resp.status_code == 201
    late = guest(app, "10.9.9.9").post(f"/api/feedback/{item_id}/comments", json={"body": "hi"})
    assert late.status_code == 429


def test_signed_in_rate_limit_and_admin_exemption(client: TestClient):
    item_id = new_item(client)
    for _ in range(MAX_COMMENTS_PER_HOUR):
        assert comment(client, item_id, user=FOURTH).status_code == 201
    assert comment(client, item_id, user=FOURTH).status_code == 429
    for _ in range(MAX_COMMENTS_PER_HOUR + 1):
        assert comment(client, item_id, user=ADMIN).status_code == 201


def test_guest_item_follows_the_same_identity(client: TestClient, app):
    g = guest(app)
    ident = g.put("/api/feedback/identity", json={"displayName": "Lan"}).json()
    created = g.post("/api/feedback", json={"kind": "bug", "title": "Broken link"}).json()
    assert created["isMine"] is True
    assert created["byline"]["name"] == "Lan"
    assert created["byline"]["pseudonym"] == ident["pseudonym"]
    seen = g.get(f"/api/feedback/{created['id']}").json()
    assert seen["isMine"] is True and seen["context"] is None


# --- reports ---------------------------------------------------------------------------------


def test_report_queue_and_dismiss(client: TestClient, app):
    item_id = new_item(client)
    bad = comment(client, item_id, "spam spam").json()
    path = f"/api/feedback/{item_id}/comments/{bad['id']}/report"
    assert client.post(path, headers=as_user(client, OTHER)).status_code == 409  # own
    ok = client.post(path, json={"reason": "Spam"}, headers=as_user(client, FOURTH))
    assert ok.status_code == 200 and ok.json() == {"reported": True}
    assert client.post(path, json={"reason": "again"}, headers=as_user(client, FOURTH)).json()
    g = guest(app)
    assert g.post(path, json={"reason": "Advertising"}).status_code == 200
    assert g.cookies.get("cb_visitor")

    assert (
        client.get("/api/feedback/comments/reported", headers=as_user(client, OTHER)).status_code
        == 403
    )
    assert client.get("/api/feedback/comments/reported").status_code == 401
    queue = client.get("/api/feedback/comments/reported", headers=as_user(client, ADMIN)).json()
    assert queue["total"] == 1
    [entry] = queue["comments"]
    assert entry["reportCount"] == 2 and set(entry["reasons"]) == {"Spam", "Advertising"}
    assert entry["item"] == {"id": item_id, "title": "Dark mode", "status": "new"}
    assert entry["body"] == "spam spam"
    # Only admins see report counts in a thread.
    assert thread(client, item_id)["comments"][0]["reportCount"] is None
    assert thread(client, item_id, user=ADMIN)["comments"][0]["reportCount"] == 2

    dismiss = f"/api/feedback/{item_id}/comments/{bad['id']}/reports"
    assert client.delete(dismiss, headers=as_user(client, OTHER)).status_code == 403
    assert client.delete(dismiss, headers=as_user(client, ADMIN)).status_code == 204
    queue = client.get("/api/feedback/comments/reported", headers=as_user(client, ADMIN)).json()
    assert queue["total"] == 0


def test_hidden_comments_leave_the_queue(client: TestClient):
    item_id = new_item(client)
    bad = comment(client, item_id, "rude").json()
    client.post(
        f"/api/feedback/{item_id}/comments/{bad['id']}/report", headers=as_user(client, FOURTH)
    )
    client.put(
        f"/api/feedback/{item_id}/comments/{bad['id']}/hidden", headers=as_user(client, ADMIN)
    )
    queue = client.get("/api/feedback/comments/reported", headers=as_user(client, ADMIN)).json()
    assert queue["total"] == 0


def test_signed_out_reading_needs_public_board(repo):
    client = TestClient(build_app(repo))
    item_id = new_item(client)
    assert client.get(f"/api/feedback/{item_id}/comments").status_code == 401
    resp = client.get(f"/api/feedback/{item_id}/comments", headers=as_user(client, OTHER))
    assert resp.status_code == 200 and resp.json()["canComment"] is True
