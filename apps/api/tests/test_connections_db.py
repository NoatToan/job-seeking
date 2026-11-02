"""`GET /api/platforms`, `PUT /api/connections/adzuna`, `DELETE /api/connections/{platform}`
(M3-01) against a real (throwaway-schema) Postgres database."""

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.main import create_app
from ujc_api.routers import connections as connections_router
from ujc_api.settings import Settings


def _settings(migrated_database_url: str, **overrides) -> Settings:
    base = dict(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
    )
    base.update(overrides)
    return Settings(**base)


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


def test_platform_catalogue_lists_all_11_sources_plus_upwork(client: TestClient):
    _sign_in(client, "catalogue@example.com")
    resp = client.get("/api/platforms")
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    ids = {i["id"] for i in items}
    assert ids == {
        "weworkremotely",
        "greenhouse",
        "lever",
        "ashby",
        "himalayas",
        "remotive",
        "seek",
        "arc",
        "adzuna",
        "linkedin",
        "glassdoor",
        "upwork",
    }
    by_id = {i["id"]: i for i in items}
    assert by_id["weworkremotely"]["kind"] == "public"
    assert by_id["adzuna"]["kind"] == "api_key"
    assert by_id["upwork"]["kind"] == "oauth"
    assert by_id["upwork"]["available"] is False  # UPWORK_ENABLED unset
    assert by_id["linkedin"]["kind"] == "runner"
    assert by_id["linkedin"]["available"] is True  # M3-06 runner pairing is built
    assert all(i["connected"] is False for i in items)  # no runner paired yet, nothing connected


def test_platform_catalogue_marks_runner_platforms_connected_once_one_is_paired(
    client: TestClient, migrated_database_url: str
):
    _sign_in(client, "runnercatalogue@example.com")
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO runners (user_id, name, token_hash)"
            " VALUES ((SELECT id FROM users WHERE email = %s), 'Test runner', 'hash')",
            ("runnercatalogue@example.com",),
        )

    resp = client.get("/api/platforms")
    by_id = {i["id"]: i for i in resp.json()["items"]}
    assert by_id["linkedin"]["connected"] is True
    assert by_id["glassdoor"]["connected"] is True
    # Unrelated platforms are unaffected.
    assert by_id["adzuna"]["connected"] is False


def test_adzuna_connect_validates_stores_encrypted_and_masks_the_key(
    client: TestClient, migrated_database_url: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(connections_router.adzuna, "verify_credentials", lambda *a, **k: True)
    csrf = _sign_in(client, "adzuna@example.com")

    resp = client.put(
        "/api/connections/adzuna",
        json={"appId": "my-app-id", "appKey": "super-secret-key"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["connected"] is True
    assert body["maskedAppKey"] == "****-key"
    assert "super-secret-key" not in resp.text

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT credentials_encrypted FROM platform_connections"
            " WHERE platform = 'adzuna' AND user_id = (SELECT id FROM users WHERE email = %s)",
            ("adzuna@example.com",),
        ).fetchone()
    assert row is not None
    raw = bytes(row[0])
    assert b"super-secret-key" not in raw
    assert b"my-app-id" not in raw

    catalogue = client.get("/api/platforms").json()["items"]
    adzuna_item = next(i for i in catalogue if i["id"] == "adzuna")
    assert adzuna_item["connected"] is True

    deleted = client.delete("/api/connections/adzuna", headers={"X-CSRF-Token": csrf})
    assert deleted.status_code == 204
    redeleted = client.delete("/api/connections/adzuna", headers={"X-CSRF-Token": csrf})
    assert redeleted.status_code == 404


def test_adzuna_connect_rejects_invalid_credentials_and_stores_nothing(
    client: TestClient, migrated_database_url: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(connections_router.adzuna, "verify_credentials", lambda *a, **k: False)
    csrf = _sign_in(client, "badkey@example.com")

    resp = client.put(
        "/api/connections/adzuna",
        json={"appId": "nope", "appKey": "nope"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_credentials"

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute("SELECT count(*) FROM platform_connections").fetchone()
    assert row is not None
    assert row[0] == 0


def test_connections_are_owner_scoped(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(connections_router.adzuna, "verify_credentials", lambda *a, **k: True)
    csrf1 = _sign_in(client, "owner3@example.com")
    connected = client.put(
        "/api/connections/adzuna",
        json={"appId": "owner-id", "appKey": "owner-key"},
        headers={"X-CSRF-Token": csrf1},
    )
    assert connected.status_code == 200

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    csrf2 = _sign_in(client, "intruder3@example.com")

    # The intruder's own catalogue shows adzuna as not connected...
    catalogue = client.get("/api/platforms").json()["items"]
    assert next(i for i in catalogue if i["id"] == "adzuna")["connected"] is False

    # ...and cannot delete the other user's connection.
    deleted = client.delete("/api/connections/adzuna", headers={"X-CSRF-Token": csrf2})
    assert deleted.status_code == 404


def test_delete_rejects_an_unknown_platform(client: TestClient):
    csrf = _sign_in(client, "unknownplatform@example.com")
    resp = client.delete("/api/connections/linkedin", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 404


def test_upwork_routes_404_when_not_enabled(client: TestClient):
    csrf = _sign_in(client, "upworkoff@example.com")

    authorize = client.get("/api/connections/upwork/authorize", follow_redirects=False)
    assert authorize.status_code == 404

    callback = client.get(
        "/api/connections/upwork/callback",
        params={"code": "x", "state": "y"},
        follow_redirects=False,
    )
    assert callback.status_code == 404

    resp = client.post("/api/upwork/search", json={"q": "python"}, headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_enabled"
