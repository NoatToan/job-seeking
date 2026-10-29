"""End-to-end flows against a real (throwaway-schema) Postgres database. Skipped with a clear
message when `TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from job_crawler.matching.cv import CvText

from ujc_api import worker
from ujc_api.main import create_app
from ujc_api.settings import Settings


def _review_settings(migrated_database_url: str) -> Settings:
    return Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="db-test-secret",
        ujc_otp_review_mode=True,
    )


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(_review_settings(migrated_database_url))
    # https:// base_url: `ujc_session`/`ujc_csrf` are `Secure` outside UJC_ENV=development (as in
    # production), and a plain-http test client would silently drop them between requests.
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, email: str) -> str:
    """Returns the CSRF token after a full otp -> verify round trip (review-mode devCode)."""
    otp_resp = client.post("/api/auth/otp", json={"email": email})
    assert otp_resp.status_code == 202, otp_resp.text
    code = otp_resp.json()["devCode"]
    verify_resp = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert verify_resp.status_code == 200, verify_resp.text
    csrf = client.cookies.get("ujc_csrf")
    assert csrf
    return csrf


def test_otp_verify_me_flow(client: TestClient):
    email = "person@example.com"
    csrf = _sign_in(client, email)

    me = client.get("/api/me")
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["email"] == email
    assert body["preferences"] == {"keywords": [], "remoteOnly": False, "candidateCountry": None}
    assert body["latestCv"] is None

    # logout needs CSRF
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 204

    after_logout = client.get("/api/me")
    assert after_logout.status_code == 401
    assert after_logout.json()["error"]["code"] == "unauthorized"


def test_verify_wrong_code_then_correct_code(client: TestClient):
    email = "retry@example.com"
    otp_resp = client.post("/api/auth/otp", json={"email": email})
    code = otp_resp.json()["devCode"]

    wrong = client.post("/api/auth/verify", json={"email": email, "code": "000000"})
    assert wrong.status_code in (400, 429)
    assert wrong.json()["error"]["code"] in ("invalid_code", "too_many_attempts")

    right = client.post("/api/auth/verify", json={"email": email, "code": code})
    assert right.status_code == 200


def test_cv_upload_creates_queued_cv_and_a_task(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "cvuser@example.com")

    resp = client.post(
        "/api/cvs",
        files={"file": ("resume.txt", b"Jane Doe, Senior Engineer", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["filename"] == "resume.txt"
    cv_id = int(body["id"])

    listed = client.get("/api/cvs")
    assert len(listed.json()["items"]) == 1

    with psycopg.connect(migrated_database_url) as conn:
        task = conn.execute(
            "SELECT kind, payload, status FROM tasks WHERE payload->>'cv_id' = %s", (str(cv_id),)
        ).fetchone()
    assert task is not None
    assert task[0] == "cv_extract"
    assert task[2] == "queued"


def test_upload_rejects_oversized_and_wrong_type(client: TestClient):
    _sign_in(client, "badupload@example.com")
    csrf = client.cookies.get("ujc_csrf")

    too_big = client.post(
        "/api/cvs",
        files={"file": ("big.pdf", b"%PDF-1.4" + b"0" * (5 * 1024 * 1024 + 1), "application/pdf")},
        headers={"X-CSRF-Token": csrf},
    )
    assert too_big.status_code == 413

    wrong_type = client.post(
        "/api/cvs",
        files={"file": ("virus.exe", b"MZ\x90\x00", "application/octet-stream")},
        headers={"X-CSRF-Token": csrf},
    )
    assert wrong_type.status_code == 415


def test_worker_processes_an_uploaded_cv_to_done(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "workeruser@example.com")
    resp = client.post(
        "/api/cvs",
        files={"file": ("cv.txt", b"hello world cv", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    cv_id = int(resp.json()["id"])

    # `migrated_database_url` is one schema shared by the whole test session, so earlier tests'
    # CVs may already have queued tasks ahead of this one in `tasks` (claimed oldest-first) —
    # drain the queue until *this* cv is no longer queued, rather than assuming one call to
    # `run_once` claims this test's own task.
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        for _ in range(50):
            (status,) = conn.execute(
                "SELECT status FROM user_cvs WHERE id = %s", (cv_id,)
            ).fetchone()
            if status != "queued":
                break
            processed = worker.run_once(
                conn,
                worker="test-worker",
                extract_text_fn=lambda _p: CvText(text="hello world cv", ocr_used=False),
                extract_profile_fn=lambda _t: {
                    "search_keywords": ["python"],
                    "skills": ["Python", "Postgres"],
                    "location": "Remote",
                },
            )
            assert processed, "queue ran dry before this test's own cv_extract task was claimed"

    with psycopg.connect(migrated_database_url) as conn:
        row = conn.execute(
            "SELECT status, keywords, text FROM user_cvs WHERE id = %s", (cv_id,)
        ).fetchone()
    assert row[0] == "done"
    assert "python" in row[1]
    assert row[2] == "hello world cv"


def test_feed_pagination_has_no_duplicates_across_pages(
    client: TestClient, migrated_database_url: str
):
    base = datetime(2026, 1, 1, tzinfo=UTC)
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        for i in range(25):
            conn.execute(
                "INSERT INTO jobs (source, external_id, url, title, company, remote, posted_at)"
                " VALUES (%s, %s, %s, %s, %s, false, %s)",
                (
                    "feed-test",
                    f"job-{i}",
                    f"https://example.test/{i}",
                    f"Job {i}",
                    "Acme",
                    base + timedelta(minutes=i),
                ),
            )

    _sign_in(client, "feeduser@example.com")

    seen_ids: list[str] = []
    cursor = None
    for _ in range(10):
        params = {"limit": 10, "source": "feed-test"}
        if cursor:
            params["cursor"] = cursor
        resp = client.get("/api/feed", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        seen_ids.extend(item["id"] for item in body["items"])
        cursor = body["nextCursor"]
        if not cursor:
            break

    assert len(seen_ids) == 25
    assert len(seen_ids) == len(set(seen_ids))


def test_feed_rejects_a_tampered_cursor(client: TestClient):
    _sign_in(client, "tamperuser@example.com")
    resp = client.get("/api/feed", params={"cursor": "not-a-valid-cursor"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_cursor"


def test_cv_detail_is_owner_scoped(client: TestClient):
    csrf1 = _sign_in(client, "owner@example.com")
    resp = client.post(
        "/api/cvs",
        files={"file": ("cv.md", b"# CV", "text/markdown")},
        headers={"X-CSRF-Token": csrf1},
    )
    cv_id = resp.json()["id"]
    assert client.get(f"/api/cvs/{cv_id}").status_code == 200

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    _sign_in(client, "intruder@example.com")
    assert client.get(f"/api/cvs/{cv_id}").status_code == 404
    assert client.get("/api/cvs/999999999").status_code == 404


def test_put_preferences_updates_and_validates(client: TestClient):
    csrf = _sign_in(client, "prefsuser@example.com")
    resp = client.put(
        "/api/me/preferences",
        json={"keywords": ["python", "react"], "remoteOnly": True, "candidateCountry": "VN"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 200
    assert resp.json()["preferences"]["keywords"] == ["python", "react"]

    me = client.get("/api/me")
    assert me.json()["preferences"]["remoteOnly"] is True
    assert me.json()["preferences"]["candidateCountry"] == "VN"

    too_many_body = {
        "keywords": [f"k{i}" for i in range(31)],
        "remoteOnly": False,
        "candidateCountry": None,
    }
    too_many = client.put("/api/me/preferences", json=too_many_body, headers={"X-CSRF-Token": csrf})
    assert too_many.status_code == 400
