"""Router authorisation and validation against an in-memory repository (no database).

User 1 is the admin, user 2 the author, user 3 another signed-in user.
"""

import base64

import pytest
from cb_fakes import CSRF, InMemoryFeedbackRepository, as_user, build_app
from fastapi.testclient import TestClient

from contributor_box.constants import MAX_ITEMS_PER_HOUR

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


def test_new_item_is_hidden_from_other_users(client: TestClient):
    item = create(client)
    assert (
        client.get(f"/api/feedback/{item['id']}", headers=as_user(client, OTHER)).status_code == 404
    )
    shot = client.get(f"/api/feedback/{item['id']}/screenshot", headers=as_user(client, OTHER))
    assert shot.status_code == 404
    board = client.get("/api/feedback", headers=as_user(client, OTHER)).json()
    assert board["items"] == []


def test_board_status_filter_cannot_reveal_private_items(client: TestClient):
    create(client)
    resp = client.get("/api/feedback?scope=board&status=new", headers=as_user(client, OTHER))
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
    assert seen["author"] == {"id": str(AUTHOR), "email": f"user{AUTHOR}@example.com"}
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


def test_votes_only_on_public_items_and_are_idempotent(client: TestClient):
    item = create(client)
    path = f"/api/feedback/{item['id']}/vote"
    assert client.put(path, headers=as_user(client, AUTHOR)).status_code == 409
    assert client.put(path, headers=as_user(client, OTHER)).status_code == 404
    approve(client, item["id"])
    first = client.put(path, headers=as_user(client, OTHER)).json()
    again = client.put(path, headers=as_user(client, OTHER)).json()
    assert first["voteCount"] == again["voteCount"] == 1
    assert again["voted"] is True
    removed = client.delete(path, headers=as_user(client, OTHER)).json()
    assert removed["voteCount"] == 0
    assert removed["voted"] is False


# --- delete -------------------------------------------------------------------------------


def test_author_can_delete_only_while_new(client: TestClient):
    first = create(client)
    assert (
        client.delete(f"/api/feedback/{first['id']}", headers=as_user(client, OTHER)).status_code
        == 404
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
