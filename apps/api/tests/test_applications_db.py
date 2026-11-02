"""End-to-end `applications` flows against a real (throwaway-schema) Postgres database. Skipped
with a clear message when `TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

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
        "source": "applications-test",
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


def test_create_list_patch_delete_and_events_flow(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "app-flow-1")
    csrf = _sign_in(client, "tracker@example.com")

    created = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"X-CSRF-Token": csrf},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "saved"
    assert body["jobId"] == str(job_id)
    assert body["job"] == {
        "title": "Senior Backend Engineer",
        "company": "Acme",
        "url": "https://example.test/app-flow-1",
        "source": "applications-test",
    }
    app_id = body["id"]

    # idempotent create: same job -> 200 with the existing row, not a new one
    again = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"X-CSRF-Token": csrf},
    )
    assert again.status_code == 200
    assert again.json()["id"] == app_id

    listed = client.get("/api/applications")
    assert listed.status_code == 200
    assert [i["id"] for i in listed.json()["items"]] == [app_id]

    filtered = client.get("/api/applications", params={"status": "applied"})
    assert filtered.json()["items"] == []

    patched = client.patch(
        f"/api/applications/{app_id}",
        json={"status": "applied", "note": "sent resume"},
        headers={"X-CSRF-Token": csrf},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "applied"
    assert patched.json()["note"] == "sent resume"

    events = client.get(f"/api/applications/{app_id}/events")
    assert events.status_code == 200
    event_items = events.json()["items"]
    # newest first: applied (from saved) then the initial saved event
    assert [e["toStatus"] for e in event_items] == ["applied", "saved"]
    assert event_items[0]["fromStatus"] == "saved"
    assert event_items[1]["fromStatus"] is None

    deleted = client.delete(f"/api/applications/{app_id}", headers={"X-CSRF-Token": csrf})
    assert deleted.status_code == 204
    assert client.get(f"/api/applications/{app_id}/events").status_code == 404


def test_snapshot_survives_job_deletion(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "app-flow-2", title="Platform Engineer")
    csrf = _sign_in(client, "snapshot@example.com")

    created = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"X-CSRF-Token": csrf},
    )
    app_id = created.json()["id"]

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute("DELETE FROM jobs WHERE id = %s", (job_id,))

    listed = client.get("/api/applications")
    item = listed.json()["items"][0]
    assert item["id"] == app_id
    assert item["jobId"] is None  # SET NULL on delete
    assert item["job"]["title"] == "Platform Engineer"  # snapshot kept


def test_applications_are_owner_scoped(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "app-flow-3")
    csrf1 = _sign_in(client, "owner2@example.com")
    created = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"X-CSRF-Token": csrf1},
    )
    app_id = created.json()["id"]

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    csrf2 = _sign_in(client, "intruder2@example.com")

    assert client.get("/api/applications").json()["items"] == []
    assert client.get(f"/api/applications/{app_id}/events").status_code == 404
    assert (
        client.patch(
            f"/api/applications/{app_id}",
            json={"status": "applied"},
            headers={"X-CSRF-Token": csrf2},
        ).status_code
        == 404
    )
    deleted = client.delete(f"/api/applications/{app_id}", headers={"X-CSRF-Token": csrf2})
    assert deleted.status_code == 404
    assert client.get("/api/applications/999999999/events").status_code == 404


def test_create_requires_an_existing_job(client: TestClient):
    csrf = _sign_in(client, "nojob@example.com")
    resp = client.post(
        "/api/applications",
        json={"jobId": "999999999"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


def test_patch_requires_at_least_one_field(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "app-flow-4")
    csrf = _sign_in(client, "emptypatch@example.com")
    created = client.post(
        "/api/applications",
        json={"jobId": str(job_id)},
        headers={"X-CSRF-Token": csrf},
    )
    app_id = created.json()["id"]

    resp = client.patch(f"/api/applications/{app_id}", json={}, headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "bad_request"


def test_create_rejects_an_invalid_status(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "app-flow-5")
    csrf = _sign_in(client, "badstatus@example.com")
    resp = client.post(
        "/api/applications",
        json={"jobId": str(job_id), "status": "ghosted"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"
