"""End-to-end runner pairing + bearer-auth flows against a real (throwaway-schema) Postgres
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


def _pair(client: TestClient, csrf: str, *, name: str = "Tony's MacBook") -> dict:
    created = client.post("/api/runners/pairing-code", headers={"X-CSRF-Token": csrf})
    assert created.status_code == 200, created.text
    code = created.json()["code"]
    paired = client.post("/api/runner/pair", json={"code": code, "name": name})
    assert paired.status_code == 200, paired.text
    return paired.json()


def test_pairing_code_is_single_use_and_then_rejected(client: TestClient):
    csrf = _sign_in(client, "runner-owner@example.com")
    created = client.post("/api/runners/pairing-code", headers={"X-CSRF-Token": csrf})
    code = created.json()["code"]

    first = client.post("/api/runner/pair", json={"code": code, "name": "Laptop"})
    assert first.status_code == 200, first.text

    second = client.post("/api/runner/pair", json={"code": code, "name": "Laptop"})
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "invalid_code"


def test_unknown_pairing_code_is_rejected(client: TestClient):
    resp = client.post("/api/runner/pair", json={"code": "ZZZZZZZZ", "name": "x"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_code"


def test_pairing_code_requires_a_session(client: TestClient):
    # No session cookie at all: `require_csrf` (checked before the handler body) rejects first,
    # same convention as every other session+CSRF route (see test_csrf.py).
    resp = client.post("/api/runners/pairing-code")
    assert resp.status_code == 403


def test_bearer_auth_and_plan(client: TestClient):
    csrf = _sign_in(client, "plan-owner@example.com")
    client.put(
        "/api/me/preferences",
        json={"keywords": ["react", "typescript"], "remoteOnly": True, "candidateCountry": "VN"},
        headers={"X-CSRF-Token": csrf},
    )
    paired = _pair(client, csrf)
    token = paired["token"]

    no_auth = client.get("/api/runner/plan")
    assert no_auth.status_code == 401

    bad_token = client.get("/api/runner/plan", headers={"Authorization": "Bearer nope"})
    assert bad_token.status_code == 401

    ok = client.get("/api/runner/plan", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["keywords"] == ["react", "typescript"]
    assert body["remoteOnly"] is True
    assert set(body["sites"]) == {"linkedin", "glassdoor", "arc"}


def test_runner_token_cannot_reach_session_endpoints(client: TestClient):
    csrf = _sign_in(client, "scope-owner@example.com")
    paired = _pair(client, csrf)
    token = paired["token"]
    client.cookies.clear()  # drop the session cookie _sign_in left behind: bearer token only
    resp = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_revoked_runner_token_gets_401(client: TestClient):
    csrf = _sign_in(client, "revoke-owner@example.com")
    paired = _pair(client, csrf)
    token, runner_id = paired["token"], paired["runnerId"]

    revoked = client.delete(f"/api/runners/{runner_id}", headers={"X-CSRF-Token": csrf})
    assert revoked.status_code == 204

    resp = client.get("/api/runner/plan", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_runners_are_owner_scoped(client: TestClient):
    csrf1 = _sign_in(client, "owner-a@example.com")
    paired = _pair(client, csrf1)
    runner_id = paired["runnerId"]

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    csrf2 = _sign_in(client, "owner-b@example.com")

    assert client.get("/api/runners").json()["items"] == []
    resp = client.delete(f"/api/runners/{runner_id}", headers={"X-CSRF-Token": csrf2})
    assert resp.status_code == 404


def test_upload_jobs_upserts_into_jobs_table(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "upload-owner@example.com")
    paired = _pair(client, csrf)
    token = paired["token"]

    resp = client.post(
        "/api/runner/jobs",
        json={
            "site": "linkedin",
            "jobs": [
                {
                    "external_id": "999",
                    "url": "https://www.linkedin.com/jobs/view/999/",
                    "title": "Staff Engineer",
                    "company": "Acme",
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"received": 1, "upserted": 1}

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT title, company, source FROM jobs"
            " WHERE source = 'linkedin' AND external_id = '999'"
        ).fetchone()
    assert row == ("Staff Engineer", "Acme", "linkedin")


def test_upload_jobs_rejects_foreign_host(client: TestClient):
    csrf = _sign_in(client, "foreign-host@example.com")
    paired = _pair(client, csrf)
    token = paired["token"]

    resp = client.post(
        "/api/runner/jobs",
        json={
            "site": "linkedin",
            "jobs": [
                {
                    "external_id": "1",
                    "url": "https://evil.example.com/jobs/view/1/",
                    "title": "Engineer",
                    "company": "Acme",
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "unprocessable"


def test_upload_jobs_rejects_unknown_site(client: TestClient):
    csrf = _sign_in(client, "unknown-site@example.com")
    paired = _pair(client, csrf)
    token = paired["token"]

    resp = client.post(
        "/api/runner/jobs",
        json={"site": "indeed", "jobs": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
