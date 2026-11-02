"""End-to-end personal access token flows (M3-08) against a real (throwaway-schema) Postgres
database. Skipped with a clear message when `TEST_DATABASE_URL` is unset (see conftest.py
`migrated_database_url`)."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.main import create_app
from ujc_api.settings import Settings


def _settings(migrated_database_url: str) -> Settings:
    return Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
    )


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(_settings(migrated_database_url))
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, email: str) -> str:
    otp_resp = client.post("/api/auth/otp", json={"email": email})
    assert otp_resp.status_code == 202, otp_resp.text
    code = otp_resp.json()["devCode"]
    verify_resp = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert verify_resp.status_code == 200, verify_resp.text
    csrf = client.cookies.get("ujc_csrf")
    assert csrf
    return csrf


def _insert_job(migrated_database_url: str, external_id: str, **overrides) -> int:
    fields = {
        "source": "tokens-test",
        "external_id": external_id,
        "url": f"https://example.test/{external_id}",
        "title": "Senior Backend Engineer",
        "company": "Acme",
        "remote": False,
        **overrides,
    }
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, remote)"
            " VALUES (%(source)s, %(external_id)s, %(url)s, %(title)s, %(company)s, %(remote)s)"
            " RETURNING id",
            fields,
        ).fetchone()
    assert row is not None
    return row[0]


def test_create_requires_session_and_csrf(client: TestClient):
    # Neither a session cookie nor a CSRF token: the CSRF dependency (which runs regardless of
    # auth) rejects this before `current_user` gets a chance to.
    resp = client.post("/api/tokens", json={"name": "ci", "scopes": ["jobs:read"]})
    assert resp.status_code == 403

    csrf = _sign_in(client, "notoken-csrf@example.com")
    resp = client.post("/api/tokens", json={"name": "ci", "scopes": ["jobs:read"]})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_failed"

    ok = client.post(
        "/api/tokens",
        json={"name": "ci", "scopes": ["jobs:read"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert ok.status_code == 201, ok.text


def test_create_rejects_unknown_scope_and_long_expiry(client: TestClient):
    csrf = _sign_in(client, "badscope@example.com")
    resp = client.post(
        "/api/tokens",
        json={"name": "ci", "scopes": ["profiles:read"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"

    resp2 = client.post(
        "/api/tokens",
        json={"name": "ci", "scopes": ["jobs:read"], "expiresInDays": 366},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp2.status_code == 400


def test_create_list_and_revoke_flow(client: TestClient):
    csrf = _sign_in(client, "lifecycle@example.com")

    created = client.post(
        "/api/tokens",
        json={"name": "My laptop", "scopes": ["jobs:read", "applications:write"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["token"].startswith("ujc_pat_")
    assert body["scopes"] == ["applications:write", "jobs:read"]
    assert body["revokedAt"] is None
    token_id = body["id"]
    raw_token = body["token"]

    listed = client.get("/api/tokens", headers={"X-CSRF-Token": csrf})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    assert "token" not in items[0]  # never shown again
    assert items[0]["id"] == token_id

    # Bearer auth works for a scoped endpoint, with no CSRF header.
    feed = client.get("/api/feed", headers={"Authorization": f"Bearer {raw_token}"})
    assert feed.status_code == 200

    # last_used_at was updated by that call.
    listed2 = client.get("/api/tokens", headers={"X-CSRF-Token": csrf})
    assert listed2.json()["items"][0]["lastUsedAt"] is not None

    revoked = client.delete(f"/api/tokens/{token_id}", headers={"X-CSRF-Token": csrf})
    assert revoked.status_code == 204

    after_revoke = client.get("/api/feed", headers={"Authorization": f"Bearer {raw_token}"})
    assert after_revoke.status_code == 401

    missing = client.delete(f"/api/tokens/{token_id}", headers={"X-CSRF-Token": csrf})
    assert missing.status_code == 404


def test_revoke_is_owner_scoped(client: TestClient):
    csrf1 = _sign_in(client, "tokenowner@example.com")
    created = client.post(
        "/api/tokens",
        json={"name": "owner's token", "scopes": ["jobs:read"]},
        headers={"X-CSRF-Token": csrf1},
    )
    token_id = created.json()["id"]

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    csrf2 = _sign_in(client, "tokenintruder@example.com")

    resp = client.delete(f"/api/tokens/{token_id}", headers={"X-CSRF-Token": csrf2})
    assert resp.status_code == 404


def test_bearer_without_declared_scope_is_forbidden(client: TestClient):
    csrf = _sign_in(client, "scopeonly@example.com")
    created = client.post(
        "/api/tokens",
        json={"name": "read-only", "scopes": ["jobs:read"]},
        headers={"X-CSRF-Token": csrf},
    )
    raw_token = created.json()["token"]

    resp = client.get("/api/applications", headers={"Authorization": f"Bearer {raw_token}"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


def test_bearer_with_invalid_token_is_unauthorized(client: TestClient):
    resp = client.get("/api/feed", headers={"Authorization": "Bearer ujc_pat_bogus"})
    assert resp.status_code == 401


def test_bearer_skips_csrf_on_applications_write(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "mcpwriter@example.com")
    created = client.post(
        "/api/tokens",
        json={"name": "mcp", "scopes": ["applications:write"]},
        headers={"X-CSRF-Token": csrf},
    )
    raw_token = created.json()["token"]

    job_id = _insert_job(migrated_database_url, "tokens-app-1")

    # No X-CSRF-Token header at all: would 403 for a session request, but bearer is exempt.
    resp = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert resp.status_code == 201, resp.text


def test_expired_token_is_unauthorized(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "expiring@example.com")
    created = client.post(
        "/api/tokens",
        json={"name": "short-lived", "scopes": ["jobs:read"], "expiresInDays": 1},
        headers={"X-CSRF-Token": csrf},
    )
    raw_token = created.json()["token"]

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE personal_tokens SET expires_at = now() - interval '1 day' WHERE id = %s",
            (created.json()["id"],),
        )

    resp = client.get("/api/feed", headers={"Authorization": f"Bearer {raw_token}"})
    assert resp.status_code == 401
