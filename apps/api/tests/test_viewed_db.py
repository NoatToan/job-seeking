"""`/api/me/viewed` (read-jobs history) against a real (throwaway-schema) Postgres database.
Skipped with a clear message when `TEST_DATABASE_URL` is unset (see conftest.py
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


def _insert_job(migrated_database_url: str, external_id: str) -> int:
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, remote)"
            " VALUES ('viewed-test', %s, %s, 'Backend Engineer', 'Acme', false) RETURNING id",
            (external_id, f"https://example.test/{external_id}"),
        ).fetchone()
    assert row is not None
    return row[0]


def _mark(client: TestClient, csrf: str, job_ids: list) -> dict:
    resp = client.post("/api/me/viewed", json={"jobIds": job_ids}, headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_unauthenticated_get_is_401(client: TestClient):
    assert client.get("/api/me/viewed").status_code == 401


def test_post_then_get_newest_first_dedup_and_unknown_ids(
    client: TestClient, migrated_database_url: str
):
    a = _insert_job(migrated_database_url, "viewed-1")
    b = _insert_job(migrated_database_url, "viewed-2")
    c = _insert_job(migrated_database_url, "viewed-3")
    csrf = _sign_in(client, "viewer@example.com")

    assert client.get("/api/me/viewed").json() == {"jobIds": []}

    assert _mark(client, csrf, [str(a)]) == {"saved": 1}
    # int and str ids both accepted; an unknown id is skipped
    assert _mark(client, csrf, [b, str(c), "999999999"]) == {"saved": 2}
    assert client.get("/api/me/viewed").json()["jobIds"] == [str(c), str(b), str(a)]

    # re-viewing `a` moves it to the front without duplicating it
    assert _mark(client, csrf, [a, str(a)]) == {"saved": 1}
    assert client.get("/api/me/viewed").json()["jobIds"] == [str(a), str(c), str(b)]
    with psycopg.connect(migrated_database_url) as conn:
        row = conn.execute(
            "SELECT count(*) FROM job_views v JOIN users u ON u.id = v.user_id"
            " WHERE u.email = 'viewer@example.com'"
        ).fetchone()
    assert row is not None and row[0] == 3

    # only unknown ids -> nothing saved
    assert _mark(client, csrf, ["888888888"]) == {"saved": 0}

    export = client.get("/api/me/export").json()
    assert [v["jobId"] for v in export["viewedJobs"]] == [str(a), str(c), str(b)]
    assert export["viewedJobs"][0]["viewedAt"]


def test_invalid_bodies_are_rejected(client: TestClient):
    # the app-wide RequestValidationError handler (main.py) answers 400 `validation_error`
    csrf = _sign_in(client, "viewer-invalid@example.com")
    for job_ids in (
        [],
        list(range(1, 502)),
        ["abc"],
        [0],
        [-1],
        ["-1"],
        [" 1"],
        [True],
        [1.5],
        [2**63],
    ):
        resp = client.post(
            "/api/me/viewed", json={"jobIds": job_ids}, headers={"X-CSRF-Token": csrf}
        )
        assert resp.status_code == 400, (job_ids, resp.text)
        assert resp.json()["error"]["code"] == "validation_error"
    assert client.post("/api/me/viewed", json={}, headers={"X-CSRF-Token": csrf}).status_code == 400


def test_writes_require_csrf(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "viewed-csrf")
    _sign_in(client, "viewer-csrf@example.com")
    assert client.post("/api/me/viewed", json={"jobIds": [job_id]}).status_code == 403
    assert client.delete("/api/me/viewed").status_code == 403


def test_delete_clears_only_own_history(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "viewed-delete")
    csrf_a = _sign_in(client, "viewer-a@example.com")
    _mark(client, csrf_a, [job_id])

    client2 = TestClient(client.app, base_url="https://testserver")
    csrf_b = _sign_in(client2, "viewer-b@example.com")
    # another user's views are not visible
    assert client2.get("/api/me/viewed").json() == {"jobIds": []}
    _mark(client2, csrf_b, [job_id])

    resp = client.delete("/api/me/viewed", headers={"X-CSRF-Token": csrf_a})
    assert resp.status_code == 204
    assert client.get("/api/me/viewed").json() == {"jobIds": []}
    assert client2.get("/api/me/viewed").json() == {"jobIds": [str(job_id)]}
