"""Feedback -> GitHub issue wired into `PATCH /api/feedback/{id}` against a real throwaway-schema
Postgres (skipped without `TEST_DATABASE_URL`). GitHub itself is faked."""

import uuid

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api import feedback_github
from ujc_api.feedback_github import CreatedIssue
from ujc_api.main import create_app
from ujc_api.settings import Settings


@pytest.fixture
def client(migrated_database_url: str):
    # A fresh admin per test: OTP requests are rate-limited per email in the database.
    admin = f"gh-boss-{uuid.uuid4().hex[:8]}@example.com"
    settings = Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
        ujc_admin_emails=admin,
        feedback_github_token="test-token",
        feedback_github_repo="acme/jobs",
    )
    with TestClient(create_app(settings), base_url="https://testserver") as c:
        c.admin_email = admin  # type: ignore[attr-defined]
        yield c


@pytest.fixture
def opened(monkeypatch) -> list[int]:
    calls: list[int] = []

    def fake_create(_settings, item):
        calls.append(item.id)
        return CreatedIssue(
            number=100 + item.id, url=f"https://github.com/acme/jobs/issues/{item.id}"
        )

    monkeypatch.setattr(feedback_github, "create_issue", fake_create)
    return calls


def _admin(client: TestClient) -> dict[str, str]:
    code = client.post("/api/auth/otp", json={"email": client.admin_email}).json()["devCode"]
    assert (
        client.post(
            "/api/auth/verify", json={"email": client.admin_email, "code": code}
        ).status_code
        == 200
    )
    return {"X-CSRF-Token": client.cookies.get("ujc_csrf") or ""}


def _item(client: TestClient, csrf: dict[str, str], kind: str = "bug") -> int:
    resp = client.post("/api/feedback", json={"kind": kind, "title": "Filter resets"}, headers=csrf)
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


def _issue(url: str, item_id: int):
    with psycopg.connect(url) as conn:
        return conn.execute(
            "SELECT repo, issue_number FROM feedback_github_issues WHERE item_id = %s", (item_id,)
        ).fetchone()


def test_planned_opens_one_issue(client, opened, migrated_database_url):
    csrf = _admin(client)
    item_id = _item(client, csrf)

    # Edits before "planned" open nothing.
    resp = client.patch(f"/api/feedback/{item_id}", json={"adminResponse": "Thanks"}, headers=csrf)
    assert resp.status_code == 200, resp.text
    assert opened == []

    resp = client.patch(f"/api/feedback/{item_id}", json={"status": "planned"}, headers=csrf)
    assert resp.status_code == 200, resp.text
    assert opened == [item_id]
    assert _issue(migrated_database_url, item_id) == ("acme/jobs", 100 + item_id)

    # Saving it again never opens a second issue.
    resp = client.patch(f"/api/feedback/{item_id}", json={"title": "Filter resets!"}, headers=csrf)
    assert resp.status_code == 200, resp.text
    assert opened == [item_id]


def test_failed_request_opens_nothing(client, opened):
    csrf = _admin(client)
    item_id = _item(client, csrf)
    no_csrf = client.patch(f"/api/feedback/{item_id}", json={"status": "planned"})
    assert no_csrf.status_code == 403
    assert opened == []


def test_github_failure_keeps_the_admin_edit_and_retries_later(
    client, monkeypatch, migrated_database_url
):
    csrf = _admin(client)
    item_id = _item(client, csrf, kind="idea")

    def down(_settings, _item):
        raise httpx.ConnectError("github down")

    monkeypatch.setattr(feedback_github, "create_issue", down)
    resp = client.patch(f"/api/feedback/{item_id}", json={"status": "planned"}, headers=csrf)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "planned"
    assert _issue(migrated_database_url, item_id) is None

    monkeypatch.setattr(
        feedback_github,
        "create_issue",
        lambda _s, item: CreatedIssue(number=9, url="https://github.com/acme/jobs/issues/9"),
    )
    client.patch(f"/api/feedback/{item_id}", json={"adminResponse": "Retry"}, headers=csrf)
    assert _issue(migrated_database_url, item_id) == ("acme/jobs", 9)
