"""Router authorisation and validation against an in-memory repository (no database).

User 1 is the admin, user 2 the author, user 3 another signed-in user.
"""

import base64

import pytest
from cb_fakes import CSRF, InMemoryFeedbackRepository, as_user, build_app
from fastapi.testclient import TestClient

from contributor_box.constants import (
    MAX_ANON_ITEMS_PER_HOUR,
    MAX_ANON_ITEMS_PER_HOUR_TOTAL,
    MAX_ITEMS_PER_HOUR,
)

ADMIN, AUTHOR, OTHER = 1, 2, 3
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32


@pytest.fixture
def repo() -> InMemoryFeedbackRepository:
    return InMemoryFeedbackRepository()


@pytest.fixture
def client(repo: InMemoryFeedbackRepository) -> TestClient:
    return TestClient(build_app(repo))


def create(client: TestClient, user: int = AUTHOR, **overrides) -> dict:
    body = {
        "kind": "bug",
        "title": "Save button does nothing",
        "body": "Clicked twice.",
        "pageUrl": "https://app.example.com/tracker/?view=board",
        "elementSelector": "main > button:nth-of-type(2)",
        "elementText": "Save",
        "region": {"x": 10, "y": 20, "width": 120, "height": 40},
        "viewportWidth": 1280,
        "viewportHeight": 800,
        "screenshot": "data:image/jpeg;base64," + base64.b64encode(JPEG).decode(),
        **overrides,
    }
    resp = client.post("/api/feedback", json=body, headers=as_user(client, user))
    assert resp.status_code == 201, resp.text
    return resp.json()


def approve(client: TestClient, item_id: str) -> None:
    resp = client.patch(
        f"/api/feedback/{item_id}", json={"status": "approved"}, headers=as_user(client, ADMIN)
    )
    assert resp.status_code == 200, resp.text


# --- authentication and CSRF ---------------------------------------------------------------


def test_anonymous_gets_401_everywhere(client: TestClient):
    assert client.get("/api/feedback").status_code == 401
    assert client.get("/api/feedback/1").status_code == 401
    assert client.get("/api/feedback/meta").status_code == 401
    resp = client.post(
        "/api/feedback", json={"kind": "idea", "title": "abc"}, headers={"X-CSRF-Token": CSRF}
    )
    assert resp.status_code == 401


UNSAFE_ROUTES = [
    ("post", "/api/feedback", {"kind": "idea", "title": "abc"}),
    ("put", "/api/feedback/1/vote", None),
    ("delete", "/api/feedback/1/vote", None),
    ("patch", "/api/feedback/1", {"status": "done"}),
    ("post", "/api/feedback/1/notes", {"body": "x"}),
    ("delete", "/api/feedback/1/notes/1", None),
    ("delete", "/api/feedback/1", None),
]


@pytest.mark.parametrize(("method", "path", "body"), UNSAFE_ROUTES)
def test_anonymous_without_csrf_gets_401_not_403(client: TestClient, method, path, body):
    resp = client.request(method.upper(), path, json=body)
    assert resp.status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/feedback", {"kind": "idea", "title": "abc"}),
        ("put", "/api/feedback/1/vote", None),
        ("delete", "/api/feedback/1/vote", None),
        ("patch", "/api/feedback/1", {"status": "done"}),
        ("post", "/api/feedback/1/notes", {"body": "x"}),
        ("delete", "/api/feedback/1/notes/1", None),
        ("delete", "/api/feedback/1", None),
    ],
)
def test_unsafe_methods_require_csrf(client: TestClient, method: str, path: str, body):
    create(client)
    headers = as_user(client, ADMIN, csrf=False)
    resp = client.request(method.upper(), path, json=body, headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "csrf_failed"


# --- create -------------------------------------------------------------------------------


def test_create_returns_item_with_context_for_author(client: TestClient, repo):
    item = create(client)
    assert item["status"] == "new"
    assert item["isMine"] is True
    assert item["author"] is None  # only admins see author identity
    assert item["context"]["pageUrl"].startswith("https://app.example.com/")
    assert item["context"]["hasScreenshot"] is True
    assert item["context"]["userAgent"] is None
    assert repo.shots[int(item["id"])][0] == "image/jpeg"


def test_create_rejects_bad_screenshot_with_field_error(client: TestClient):
    resp = client.post(
        "/api/feedback",
        json={"kind": "bug", "title": "abc", "screenshot": "data:image/svg+xml;base64,PHN2Zz4="},
        headers=as_user(client, AUTHOR),
    )
    assert resp.status_code == 400
    assert "screenshot" in resp.json()["detail"]["fields"]


def test_create_rejects_javascript_page_url(client: TestClient):
    resp = client.post(
        "/api/feedback",
        json={"kind": "bug", "title": "abc", "pageUrl": "javascript:alert(1)"},
        headers=as_user(client, AUTHOR),
    )
    assert resp.status_code == 422


def test_create_cannot_set_status(client: TestClient):
    resp = client.post(
        "/api/feedback",
        json={"kind": "idea", "title": "abc", "status": "approved"},
        headers=as_user(client, AUTHOR),
    )
    assert resp.status_code == 422


def test_create_is_rate_limited_per_author_but_not_for_admins(client: TestClient):
    for _ in range(MAX_ITEMS_PER_HOUR):
        create(client, screenshot=None)
    resp = client.post(
        "/api/feedback", json={"kind": "idea", "title": "one more"}, headers=as_user(client, AUTHOR)
    )
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "3600"
    create(client, user=OTHER, screenshot=None)


# --- visibility ---------------------------------------------------------------------------


def reject(client: TestClient, item_id: str) -> None:
    resp = client.patch(
        f"/api/feedback/{item_id}", json={"status": "rejected"}, headers=as_user(client, ADMIN)
    )
    assert resp.status_code == 200, resp.text


def test_new_item_is_public_without_context(client: TestClient):
    item = create(client)
    seen = client.get(f"/api/feedback/{item['id']}", headers=as_user(client, OTHER))
    assert seen.status_code == 200
    assert seen.json()["context"] is None and seen.json()["author"] is None
    assert seen.json()["byline"]["name"] == "user2"  # email local part, never the email
    board = client.get("/api/feedback", headers=as_user(client, OTHER)).json()
    assert [i["id"] for i in board["items"]] == [item["id"]]


def test_rejected_item_is_hidden_from_other_users(client: TestClient):
    item = create(client)
    reject(client, item["id"])
    assert (
        client.get(f"/api/feedback/{item['id']}", headers=as_user(client, OTHER)).status_code == 404
    )
    shot = client.get(f"/api/feedback/{item['id']}/screenshot", headers=as_user(client, OTHER))
    assert shot.status_code == 404
    board = client.get("/api/feedback", headers=as_user(client, OTHER)).json()
    assert board["items"] == []


def test_board_status_filter_cannot_reveal_private_items(client: TestClient):
    item = create(client)
    reject(client, item["id"])
    resp = client.get("/api/feedback?scope=board&status=rejected", headers=as_user(client, OTHER))
    assert resp.json()["items"] == []


def test_approved_item_is_public_without_context(client: TestClient):
    item = create(client)
    approve(client, item["id"])
    seen = client.get(f"/api/feedback/{item['id']}", headers=as_user(client, OTHER)).json()
    assert seen["context"] is None
    assert seen["author"] is None
    assert seen["isMine"] is False
    shot = client.get(f"/api/feedback/{item['id']}/screenshot", headers=as_user(client, OTHER))
    assert shot.status_code == 404
    board = client.get("/api/feedback?scope=board", headers=as_user(client, OTHER)).json()
    assert [i["id"] for i in board["items"]] == [item["id"]]


def test_author_and_admin_can_fetch_screenshot_with_safe_headers(client: TestClient):
    item = create(client)
    for user in (AUTHOR, ADMIN):
        resp = client.get(f"/api/feedback/{item['id']}/screenshot", headers=as_user(client, user))
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert "sandbox" in resp.headers["content-security-policy"]
        assert resp.content == JPEG


def test_admin_sees_author_and_user_agent(client: TestClient):
    item = create(client)
    seen = client.get(f"/api/feedback/{item['id']}", headers=as_user(client, ADMIN)).json()
    assert seen["author"] == {
        "id": str(AUTHOR),
        "email": f"user{AUTHOR}@example.com",
        "name": None,
        "anonymous": False,
    }
    assert seen["context"]["userAgent"]


def test_scope_all_is_admin_only(client: TestClient):
    create(client)
    assert client.get("/api/feedback?scope=all", headers=as_user(client, OTHER)).status_code == 403
    resp = client.get("/api/feedback?scope=all", headers=as_user(client, ADMIN))
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


def test_mine_lists_only_own_items(client: TestClient):
    create(client)
    create(client, user=OTHER)
    mine = client.get("/api/feedback?scope=mine", headers=as_user(client, AUTHOR)).json()
    assert mine["total"] == 1
    assert mine["items"][0]["isMine"] is True


def test_meta_reports_admin_flag(client: TestClient):
    assert client.get("/api/feedback/meta", headers=as_user(client, ADMIN)).json()["isAdmin"]
    assert not client.get("/api/feedback/meta", headers=as_user(client, OTHER)).json()["isAdmin"]


def test_invalid_ids_and_queries(client: TestClient):
    assert client.get("/api/feedback/0", headers=as_user(client, AUTHOR)).status_code == 422
    assert client.get("/api/feedback/abc", headers=as_user(client, AUTHOR)).status_code == 422
    resp = client.get("/api/feedback?limit=500", headers=as_user(client, AUTHOR))
    assert resp.status_code == 422
    resp = client.get("/api/feedback?scope=everything", headers=as_user(client, AUTHOR))
    assert resp.status_code == 422


# --- admin actions ------------------------------------------------------------------------


@pytest.mark.parametrize("user", [AUTHOR, OTHER])
def test_non_admin_cannot_patch_or_add_notes(client: TestClient, user: int):
    item = create(client)
    patch = client.patch(
        f"/api/feedback/{item['id']}", json={"status": "approved"}, headers=as_user(client, user)
    )
    assert patch.status_code == 403
    note = client.post(
        f"/api/feedback/{item['id']}/notes", json={"body": "x"}, headers=as_user(client, user)
    )
    assert note.status_code == 403


def test_admin_patch_edits_and_records_status_history(client: TestClient):
    item = create(client)
    resp = client.patch(
        f"/api/feedback/{item['id']}",
        json={"status": "planned", "title": "Save button broken", "adminResponse": "On it"},
        headers=as_user(client, ADMIN),
    )
    body = resp.json()
    assert body["status"] == "planned"
    assert body["title"] == "Save button broken"
    assert body["adminResponse"] == "On it"
    history = [n for n in body["notes"] if n["kind"] == "status"]
    assert history[0]["fromStatus"] == "new"
    assert history[0]["toStatus"] == "planned"


def test_admin_patch_missing_item_is_404(client: TestClient):
    resp = client.patch("/api/feedback/99", json={"status": "done"}, headers=as_user(client, ADMIN))
    assert resp.status_code == 404


def test_internal_notes_are_admin_only(client: TestClient):
    item = create(client)
    approve(client, item["id"])
    for visibility in ("internal", "public"):
        resp = client.post(
            f"/api/feedback/{item['id']}/notes",
            json={"body": f"{visibility} note", "visibility": visibility},
            headers=as_user(client, ADMIN),
        )
        assert resp.status_code == 201
    as_admin = client.get(f"/api/feedback/{item['id']}", headers=as_user(client, ADMIN)).json()
    as_other = client.get(f"/api/feedback/{item['id']}", headers=as_user(client, OTHER)).json()
    admin_bodies = {n["body"] for n in as_admin["notes"] if n["kind"] == "note"}
    other_bodies = {n["body"] for n in as_other["notes"] if n["kind"] == "note"}
    assert admin_bodies == {"internal note", "public note"}
    assert other_bodies == {"public note"}
    assert all(n["authorEmail"] is None for n in as_other["notes"])


def test_admin_can_delete_note(client: TestClient, repo):
    item = create(client)
    note = client.post(
        f"/api/feedback/{item['id']}/notes", json={"body": "x"}, headers=as_user(client, ADMIN)
    ).json()
    path = f"/api/feedback/{item['id']}/notes/{note['id']}"
    assert client.delete(path, headers=as_user(client, OTHER)).status_code == 403
    assert client.delete(path, headers=as_user(client, ADMIN)).status_code == 204
    assert client.delete(path, headers=as_user(client, ADMIN)).status_code == 404


# --- votes ----------------------------------------------------------------------------------


def test_votes_are_up_or_down_on_public_items_only(client: TestClient):
    item = create(client)
    path = f"/api/feedback/{item['id']}/vote"
    reject(client, item["id"])
    assert client.put(path, headers=as_user(client, AUTHOR)).status_code == 409
    assert client.put(path, headers=as_user(client, OTHER)).status_code == 404
    approve(client, item["id"])
    # No body = upvote (what the endpoint always did); idempotent.
    first = client.put(path, headers=as_user(client, OTHER)).json()
    again = client.put(path, json={"value": 1}, headers=as_user(client, OTHER)).json()
    assert first["score"] == again["score"] == 1
    assert again["myVote"] == 1 and again["upvotes"] == 1
    # Switch to a downvote; another user's downvote stacks.
    down = client.put(path, json={"value": -1}, headers=as_user(client, OTHER)).json()
    assert (down["score"], down["upvotes"], down["downvotes"], down["myVote"]) == (-1, 0, 1, -1)
    both = client.put(path, json={"value": -1}, headers=as_user(client, ADMIN)).json()
    assert both["score"] == -2 and both["myVote"] == -1
    removed = client.delete(path, headers=as_user(client, OTHER)).json()
    assert removed["score"] == -1 and removed["myVote"] == 0
    bad = client.put(path, json={"value": 2}, headers=as_user(client, OTHER))
    assert bad.status_code == 422


def test_board_top_sort_is_by_score(client: TestClient):
    low, high = create(client, title="Low"), create(client, title="High")
    client.put(f"/api/feedback/{low['id']}/vote", json={"value": -1}, headers=as_user(client, 3))
    client.put(f"/api/feedback/{high['id']}/vote", headers=as_user(client, 3))
    board = client.get("/api/feedback?sort=top", headers=as_user(client, 3)).json()
    assert [i["title"] for i in board["items"]] == ["High", "Low"]


# --- delete -------------------------------------------------------------------------------


def test_author_can_delete_only_while_new(client: TestClient):
    first = create(client)
    assert (
        client.delete(f"/api/feedback/{first['id']}", headers=as_user(client, OTHER)).status_code
        == 403
    )
    assert (
        client.delete(f"/api/feedback/{first['id']}", headers=as_user(client, AUTHOR)).status_code
        == 204
    )
    second = create(client)
    approve(client, second["id"])
    assert (
        client.delete(f"/api/feedback/{second['id']}", headers=as_user(client, AUTHOR)).status_code
        == 403
    )
    assert (
        client.delete(f"/api/feedback/{second['id']}", headers=as_user(client, OTHER)).status_code
        == 403
    )
    assert (
        client.delete(f"/api/feedback/{second['id']}", headers=as_user(client, ADMIN)).status_code
        == 204
    )


def test_patchable_fields_match_the_patch_model():
    from contributor_box.repository import _PATCHABLE
    from contributor_box.schemas import AdminPatchRequest

    assert set(AdminPatchRequest.model_fields) == set(_PATCHABLE)


# --- anonymous submissions (opt-in) ---------------------------------------------------------

IDEA = {"kind": "idea", "title": "Dark mode please"}


@pytest.fixture
def anon_client(repo: InMemoryFeedbackRepository) -> TestClient:
    return TestClient(build_app(repo, allow_anonymous=True))


def anon_headers(ip: str = "203.0.113.7") -> dict[str, str]:
    return {"X-CSRF-Token": CSRF, "X-Forwarded-For": f"{ip}, 10.0.0.1"}


def test_anonymous_create_is_off_by_default(client: TestClient, repo):
    resp = client.post("/api/feedback", json=IDEA, headers=anon_headers())
    assert resp.status_code == 401
    assert repo.items == {}


def test_anonymous_create_when_allowed(anon_client: TestClient, repo):
    resp = anon_client.post(
        "/api/feedback", json={**IDEA, "authorName": "  Minh "}, headers=anon_headers()
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Dark mode please"
    # The visitor cookie ties the item to this visitor ("you"), without an account.
    assert body["isMine"] is True
    assert body["canDelete"] is False
    assert body["context"] is None
    assert body["author"] is None
    assert body["byline"]["kind"] == "guest" and body["byline"]["name"] == "Minh"
    stored = repo.items[int(body["id"])]
    assert stored["author_id"] is None
    # The typed name became the visitor's display name (same scheme as comments).
    assert stored["author_name"] is None and stored["visitor_key"]
    assert repo.names[("visitor", stored["visitor_key"])] == "Minh"
    assert anon_client.cookies.get("cb_visitor")
    # The key is an HMAC of the first X-Forwarded-For hop, never the raw IP.
    assert stored["anon_key"] and "203.0.113.7" not in stored["anon_key"]


def test_anonymous_create_still_requires_csrf(anon_client: TestClient):
    resp = anon_client.post("/api/feedback", json=IDEA, headers={"X-Forwarded-For": "1.2.3.4"})
    assert resp.status_code == 403


def test_anonymous_is_create_only(anon_client: TestClient):
    created = anon_client.post("/api/feedback", json=IDEA, headers=anon_headers()).json()
    assert anon_client.get("/api/feedback").status_code == 401
    assert anon_client.get(f"/api/feedback/{created['id']}").status_code == 401
    assert anon_client.get("/api/feedback/meta").status_code == 401
    assert (
        anon_client.delete(f"/api/feedback/{created['id']}", headers=anon_headers()).status_code
        == 401
    )
    assert (
        anon_client.put(f"/api/feedback/{created['id']}/vote", headers=anon_headers()).status_code
        == 401
    )


def test_signed_in_create_unchanged_when_anonymous_allowed(anon_client: TestClient, repo):
    resp = anon_client.post(
        "/api/feedback",
        json={**IDEA, "authorName": "Ignored"},
        headers=as_user(anon_client, AUTHOR),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["isMine"] is True
    stored = repo.items[int(body["id"])]
    assert stored["author_id"] == AUTHOR
    assert stored["author_name"] is None
    assert stored["anon_key"] is None


def test_admin_sees_anonymous_author_name(anon_client: TestClient):
    created = anon_client.post(
        "/api/feedback", json={**IDEA, "authorName": "Minh"}, headers=anon_headers()
    ).json()
    seen = anon_client.get(f"/api/feedback/{created['id']}", headers=as_user(anon_client, ADMIN))
    author = seen.json()["author"]
    assert author["id"] is None and author["email"] is None and author["anonymous"] is True
    assert author["name"].startswith("Minh (") and "#" in author["name"]
    # Other users see the item (it is public while new) with the byline only.
    other = anon_client.get(f"/api/feedback/{created['id']}", headers=as_user(anon_client, OTHER))
    assert other.status_code == 200 and other.json()["author"] is None
    assert other.json()["byline"]["name"] == "Minh"


def test_anonymous_create_without_visitor_cookies_keeps_the_typed_name(repo):
    client = TestClient(build_app(repo, allow_anonymous=True, visitor_cookies=False))
    created = client.post(
        "/api/feedback", json={**IDEA, "authorName": "Minh"}, headers=anon_headers()
    ).json()
    stored = repo.items[int(created["id"])]
    assert stored["author_name"] == "Minh" and stored["visitor_key"] is None
    assert created["byline"]["name"] == "Minh" and created["isMine"] is False
    assert "cb_visitor" not in client.cookies


def test_anonymous_create_rejects_reserved_names(anon_client: TestClient, repo):
    resp = anon_client.post(
        "/api/feedback", json={**IDEA, "authorName": "Admin"}, headers=anon_headers()
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["fields"]["authorName"] == "is reserved"
    assert repo.items == {}


def test_anonymous_rate_limit_per_key_and_total(anon_client: TestClient):
    for _ in range(MAX_ANON_ITEMS_PER_HOUR):
        assert (
            anon_client.post("/api/feedback", json=IDEA, headers=anon_headers()).status_code == 201
        )
    resp = anon_client.post("/api/feedback", json=IDEA, headers=anon_headers())
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "3600"
    # Another address still gets through ...
    assert (
        anon_client.post(
            "/api/feedback", json=IDEA, headers=anon_headers("198.51.100.1")
        ).status_code
        == 201
    )


def test_anonymous_global_cap(anon_client: TestClient, repo):
    for n in range(MAX_ANON_ITEMS_PER_HOUR_TOTAL):
        resp = anon_client.post("/api/feedback", json=IDEA, headers=anon_headers(f"10.1.{n}.1"))
        assert resp.status_code == 201
    resp = anon_client.post("/api/feedback", json=IDEA, headers=anon_headers("10.9.9.9"))
    assert resp.status_code == 429


def test_allow_anonymous_requires_optional_deps():
    from contributor_box.router import FeedbackDeps, create_feedback_router

    deps = FeedbackDeps(
        current_user=lambda: None,
        viewer_is_admin=lambda: False,
        get_repo=lambda: None,
        require_csrf=lambda: None,
    )
    with pytest.raises(ValueError):
        create_feedback_router(deps, allow_anonymous=True)


# --- public board (opt-in) ------------------------------------------------------------------


@pytest.fixture
def public_client(repo: InMemoryFeedbackRepository) -> TestClient:
    return TestClient(build_app(repo, public_board=True))


def set_status(client: TestClient, item_id: str, status: str) -> None:
    resp = client.patch(
        f"/api/feedback/{item_id}", json={"status": status}, headers=as_user(client, ADMIN)
    )
    assert resp.status_code == 200, resp.text


def seed_board(client: TestClient) -> dict[str, str]:
    """One item per status; returns status -> id. Each public item gets a vote from OTHER."""
    ids: dict[str, str] = {}
    for status in ("new", "under_review", "approved", "planned", "done", "rejected"):
        item = create(client, title=f"Item {status}")
        if status != "new":
            set_status(client, item["id"], status)
        ids[status] = item["id"]
    for status in ("approved", "planned", "done"):
        resp = client.put(f"/api/feedback/{ids[status]}/vote", headers=as_user(client, OTHER))
        assert resp.status_code == 200
    return ids


def test_public_board_is_off_by_default(client: TestClient):
    create(client)
    assert client.get("/api/feedback?scope=board").status_code == 401
    assert client.get("/api/feedback/stats").status_code == 401
    assert client.get("/api/feedback/1").status_code == 401


def test_signed_out_board_lists_public_items_without_private_fields(public_client: TestClient):
    ids = seed_board(public_client)
    resp = public_client.get("/api/feedback?scope=board&sort=top")
    assert resp.status_code == 200, resp.text
    page = resp.json()
    assert {i["status"] for i in page["items"]} == {
        "new",
        "under_review",
        "approved",
        "planned",
        "done",
    }
    assert page["total"] == 5
    for item in page["items"]:
        assert item["score"] == (1 if item["status"] in ("approved", "planned", "done") else 0)
        assert item["myVote"] == 0
        assert item["canVote"] is False
        assert item["isMine"] is False
        assert item["canDelete"] is False
        assert item["context"] is None
        assert item["author"] is None
    # Default scope is the board too.
    assert public_client.get("/api/feedback").json()["total"] == 5
    # A status filter for a private status is empty, never a way in.
    for status in ("rejected",):
        resp = public_client.get(f"/api/feedback?scope=board&status={status}")
        assert resp.json()["items"] == []
    planned = public_client.get("/api/feedback?status=planned").json()["items"]
    assert [i["id"] for i in planned] == [ids["planned"]]


@pytest.mark.parametrize("scope", ["mine", "all"])
def test_signed_out_cannot_list_other_scopes(public_client: TestClient, scope: str):
    seed_board(public_client)
    resp = public_client.get(f"/api/feedback?scope={scope}")
    assert resp.status_code == 401


def test_signed_out_detail_public_only_with_public_notes(public_client: TestClient):
    ids = seed_board(public_client)
    planned = ids["planned"]
    for visibility in ("internal", "public"):
        public_client.post(
            f"/api/feedback/{planned}/notes",
            json={"body": f"{visibility} note", "visibility": visibility},
            headers=as_user(public_client, ADMIN),
        )
    resp = public_client.get(f"/api/feedback/{planned}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["context"] is None
    assert body["author"] is None
    assert body["canVote"] is False
    assert body["myVote"] == 0
    notes = [n["body"] for n in body["notes"] if n["kind"] == "note"]
    assert notes == ["public note"]
    assert all(n["authorEmail"] is None for n in body["notes"])
    for status in ("new", "under_review"):
        assert public_client.get(f"/api/feedback/{ids[status]}").status_code == 200
    assert public_client.get(f"/api/feedback/{ids['rejected']}").status_code == 404
    assert public_client.get("/api/feedback/999").status_code == 404


def test_signed_out_still_cannot_vote_or_see_screenshots(public_client: TestClient):
    ids = seed_board(public_client)
    approved = ids["approved"]
    vote = public_client.put(f"/api/feedback/{approved}/vote", headers={"X-CSRF-Token": CSRF})
    assert vote.status_code == 401
    assert public_client.get(f"/api/feedback/{approved}/screenshot").status_code == 401
    assert public_client.get("/api/feedback/meta").status_code == 401
    # Not opened by `public_board` alone: anonymous create stays off.
    resp = public_client.post("/api/feedback", json=IDEA, headers={"X-CSRF-Token": CSRF})
    assert resp.status_code == 401


def test_signed_in_reads_unchanged_with_public_board(public_client: TestClient):
    ids = seed_board(public_client)
    board = public_client.get("/api/feedback", headers=as_user(public_client, OTHER)).json()
    voted = [i for i in board["items"] if i["status"] in ("approved", "planned", "done")]
    assert len(voted) == 3 and all(i["myVote"] == 1 and i["canVote"] for i in voted)
    mine = public_client.get("/api/feedback?scope=mine", headers=as_user(public_client, AUTHOR))
    assert mine.json()["total"] == 6
    # Admin still reads private items and context; the author still sees their own.
    hidden_path = f"/api/feedback/{ids['rejected']}"
    seen = public_client.get(hidden_path, headers=as_user(public_client, ADMIN)).json()
    assert seen["context"] is not None
    assert seen["author"] is not None
    own = public_client.get(hidden_path, headers=as_user(public_client, AUTHOR))
    assert own.json()["isMine"] is True
    other = public_client.get(hidden_path, headers=as_user(public_client, OTHER))
    assert other.status_code == 404
    everything = public_client.get("/api/feedback?scope=all", headers=as_user(public_client, ADMIN))
    assert everything.json()["total"] == 6


def test_stats_count_public_statuses_only(public_client: TestClient):
    seed_board(public_client)
    extra = create(public_client, title="Another planned")
    set_status(public_client, extra["id"], "planned")
    expected = {
        "counts": {"new": 1, "under_review": 1, "approved": 1, "planned": 2, "done": 1},
        "total": 6,
    }
    assert public_client.get("/api/feedback/stats").json() == expected
    # Same numbers for everyone, admins included (private statuses are the admin queue's job).
    as_admin = public_client.get("/api/feedback/stats", headers=as_user(public_client, ADMIN))
    assert as_admin.json() == expected


def test_stats_needs_sign_in_without_public_board(client: TestClient):
    assert client.get("/api/feedback/stats").status_code == 401
    resp = client.get("/api/feedback/stats", headers=as_user(client, OTHER))
    assert resp.json() == {
        "counts": {"new": 0, "under_review": 0, "approved": 0, "planned": 0, "done": 0},
        "total": 0,
    }


def test_public_board_requires_optional_deps():
    from contributor_box.router import FeedbackDeps, create_feedback_router

    deps = FeedbackDeps(
        current_user=lambda: None,
        viewer_is_admin=lambda: False,
        get_repo=lambda: None,
        require_csrf=lambda: None,
        optional_user=lambda: None,
    )
    with pytest.raises(ValueError):
        create_feedback_router(deps, public_board=True)


# --- keyset pagination ------------------------------------------------------------------------


@pytest.mark.parametrize("sort", ["top", "new"])
def test_load_more_with_a_cursor(public_client: TestClient, sort: str):
    ids = [create(public_client, title=f"Item number {n}", screenshot=None)["id"] for n in range(5)]
    for voter in (3, 4):
        public_client.put(f"/api/feedback/{ids[1]}/vote", headers=as_user(public_client, voter))
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params = {"sort": sort, "limit": 2, **({"cursor": cursor} if cursor else {})}
        page = public_client.get("/api/feedback", params=params).json()
        pages += 1
        # Counted on the first page only.
        assert page["total"] == (5 if pages == 1 else None)
        seen += [i["id"] for i in page["items"]]
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert sorted(seen) == sorted(ids) and len(seen) == 5
    if sort == "top":
        assert seen[0] == ids[1]
    else:
        assert seen == list(reversed(ids))


def test_bad_cursors_are_400(public_client: TestClient):
    create(public_client, screenshot=None)
    create(public_client, screenshot=None)
    first = public_client.get("/api/feedback", params={"sort": "new", "limit": 1}).json()
    other_sort = public_client.get(
        "/api/feedback", params={"sort": "top", "cursor": first["nextCursor"]}
    )
    assert other_sort.status_code == 400
    assert other_sort.json()["detail"]["fields"] == {"cursor": "invalid cursor"}
    for junk in ("x", "eyJzIjoibmV3In0", "!!!"):
        resp = public_client.get("/api/feedback", params={"sort": "new", "cursor": junk})
        assert resp.status_code == 400
