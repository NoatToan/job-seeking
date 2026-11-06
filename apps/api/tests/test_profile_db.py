"""`GET/PATCH /api/me/profile` against a real (throwaway-schema) Postgres database. Skipped with
a clear message when `TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

import uuid

import pytest
from fastapi.testclient import TestClient

from ujc_api.main import create_app
from ujc_api.settings import Settings


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(
        Settings(
            database_url=migrated_database_url,
            ujc_env="test",
            ujc_secret_key="db-test-secret",
            ujc_otp_review_mode=True,
        )
    )
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, email: str) -> str:
    otp = client.post("/api/auth/otp", json={"email": email})
    assert otp.status_code == 202, otp.text
    verify = client.post("/api/auth/verify", json={"email": email, "code": otp.json()["devCode"]})
    assert verify.status_code == 200, verify.text
    csrf = client.cookies.get("ujc_csrf")
    assert csrf
    return csrf


def test_profile_requires_sign_in(client: TestClient):
    assert client.get("/api/me/profile").status_code == 401


def test_new_user_gets_an_empty_profile_with_default_time_zone(client: TestClient):
    _sign_in(client, "profile-empty@example.com")
    resp = client.get("/api/me/profile")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "profile": {
            "displayName": None,
            "headline": None,
            "links": {"linkedin": None, "github": None, "website": None},
            "candidateCountry": None,
            "timeZone": "Asia/Ho_Chi_Minh",
            "keywords": [],
            "remoteOnly": False,
        }
    }
    me = client.get("/api/me").json()
    assert me["user"]["displayName"] is None
    assert me["user"]["headline"] is None


def test_patch_requires_csrf(client: TestClient):
    _sign_in(client, "profile-csrf@example.com")
    resp = client.patch("/api/me/profile", json={"displayName": "Linh"})
    assert resp.status_code == 403


def test_patch_writes_both_tables_and_is_partial(client: TestClient):
    csrf = _sign_in(client, "profile-full@example.com")
    headers = {"X-CSRF-Token": csrf}
    resp = client.patch(
        "/api/me/profile",
        json={
            "displayName": "  Linh   Nguyen ",
            "headline": "Senior React developer",
            "links": {
                "linkedin": "https://www.linkedin.com/in/linh",
                "github": "https://github.com/linh",
            },
            "candidateCountry": "vn",
            "timeZone": "Australia/Sydney",
            "keywords": ["React", "TypeScript"],
            "remoteOnly": True,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    profile = resp.json()["profile"]
    assert profile["displayName"] == "Linh Nguyen"
    assert profile["links"] == {
        "linkedin": "https://www.linkedin.com/in/linh",
        "github": "https://github.com/linh",
        "website": None,
    }
    assert profile["candidateCountry"] == "VN"
    assert profile["timeZone"] == "Australia/Sydney"

    # The rest of the app reads the same values.
    me = client.get("/api/me").json()
    assert me["user"]["displayName"] == "Linh Nguyen"
    assert me["user"]["headline"] == "Senior React developer"
    assert me["preferences"]["digestTz"] == "Australia/Sydney"
    assert me["preferences"]["keywords"] == ["React", "TypeScript"]
    assert me["preferences"]["remoteOnly"] is True
    # Digest settings the profile doesn't manage keep their defaults.
    assert me["preferences"]["digestEnabled"] is True
    assert me["preferences"]["digestHour"] == 7

    # Partial: only the headline and GitHub change; null/empty clear.
    resp = client.patch(
        "/api/me/profile",
        json={"headline": None, "links": {"github": ""}},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    profile = resp.json()["profile"]
    assert profile["headline"] is None
    assert profile["links"]["github"] is None
    assert profile["links"]["linkedin"] == "https://www.linkedin.com/in/linh"
    assert profile["displayName"] == "Linh Nguyen"
    assert profile["keywords"] == ["React", "TypeScript"]

    export = client.get("/api/me/export").json()
    assert export["profile"]["displayName"] == "Linh Nguyen"


def test_patch_keeps_digest_settings_from_preferences(client: TestClient):
    csrf = _sign_in(client, "profile-digest@example.com")
    headers = {"X-CSRF-Token": csrf}
    client.put(
        "/api/me/preferences",
        json={
            "keywords": ["go"],
            "remoteOnly": False,
            "candidateCountry": None,
            "digestEnabled": False,
            "digestHour": 9,
            "digestTz": "Europe/Berlin",
        },
        headers=headers,
    )
    resp = client.patch("/api/me/profile", json={"remoteOnly": True}, headers=headers)
    assert resp.status_code == 200, resp.text
    prefs = client.get("/api/me").json()["preferences"]
    assert prefs == {
        "keywords": ["go"],
        "remoteOnly": True,
        "candidateCountry": None,
        "digestEnabled": False,
        "digestHour": 9,
        "digestTz": "Europe/Berlin",
    }


@pytest.mark.parametrize(
    "body",
    [
        {"links": {"website": "http://insecure.example"}},
        {"links": {"linkedin": "https://evil.example/in/x"}},
        {"displayName": "x" * 61},
        {"timeZone": "Not/AZone"},
        {"email": "takeover@example.com"},
    ],
)
def test_patch_rejects_invalid_input_without_writing(client: TestClient, body: dict):
    # A fresh address per case: the OTP endpoint rate-limits per email.
    csrf = _sign_in(client, f"profile-invalid-{uuid.uuid4().hex[:8]}@example.com")
    resp = client.patch("/api/me/profile", json=body, headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"]["code"]
    profile = client.get("/api/me/profile").json()["profile"]
    assert profile["links"]["website"] is None
    assert profile["displayName"] is None


def test_users_only_see_their_own_profile(client: TestClient):
    csrf = _sign_in(client, "profile-owner@example.com")
    client.patch("/api/me/profile", json={"displayName": "Owner"}, headers={"X-CSRF-Token": csrf})
    other = TestClient(client.app, base_url="https://testserver")
    _sign_in(other, "profile-other@example.com")
    assert other.get("/api/me/profile").json()["profile"]["displayName"] is None
