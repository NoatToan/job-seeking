"""End-to-end onboarding flag (M4-07) against a real (throwaway-schema) Postgres database:
`GET /api/me` starts with `onboardedAt: null`, `POST /api/me/onboarded` sets it (requires CSRF),
and it survives a fresh `GET /api/me`. Skipped with a clear message when `TEST_DATABASE_URL` is
unset (see conftest.py `migrated_database_url`)."""

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


def test_onboarded_at_starts_null_then_set_requires_csrf(client: TestClient):
    _sign_in(client, "onboarding-user@example.com")

    me_before = client.get("/api/me")
    assert me_before.status_code == 200, me_before.text
    assert me_before.json()["user"]["onboardedAt"] is None

    # no CSRF header
    no_csrf = client.post("/api/me/onboarded")
    assert no_csrf.status_code == 403

    csrf = client.cookies.get("ujc_csrf")
    done = client.post("/api/me/onboarded", headers={"X-CSRF-Token": csrf})
    assert done.status_code == 200, done.text
    assert done.json()["onboardedAt"]

    me_after = client.get("/api/me")
    assert me_after.status_code == 200, me_after.text
    assert me_after.json()["user"]["onboardedAt"]
