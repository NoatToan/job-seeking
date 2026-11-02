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
    assert body["preferences"] == {
        "keywords": [],
        "remoteOnly": False,
        "candidateCountry": None,
        "digestEnabled": True,
        "digestHour": 7,
        "digestTz": "Asia/Ho_Chi_Minh",
    }
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


def _consent(client: TestClient, csrf: str) -> None:
    """`POST /api/cvs` 409s without AI-processing consent (M5-04) — upload tests need this first."""
    resp = client.post(
        "/api/me/consent", json={"aiProcessing": True}, headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 200, resp.text


def test_cv_upload_creates_queued_cv_and_a_task(client: TestClient, migrated_database_url: str):
    csrf = _sign_in(client, "cvuser@example.com")
    _consent(client, csrf)

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
    _consent(client, csrf)

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
    _consent(client, csrf)
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
    _consent(client, csrf1)
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


def test_get_job_returns_description_and_404s_when_missing(
    client: TestClient, migrated_database_url: str
):
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, description)"
            " VALUES ('weworkremotely', 'detail-1', 'https://example.test/detail-1',"
            " 'Senior Engineer', 'Acme', 'Full description here') RETURNING id"
        ).fetchone()
        job_id = row[0]

    _sign_in(client, "jobviewer@example.com")

    found = client.get(f"/api/jobs/{job_id}")
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["id"] == str(job_id)
    assert body["title"] == "Senior Engineer"
    assert body["description"] == "Full description here"

    missing = client.get("/api/jobs/999999999")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_get_job_requires_a_session(client: TestClient):
    resp = client.get("/api/jobs/1")
    assert resp.status_code == 401


def test_get_job_rejects_a_non_numeric_id(client: TestClient):
    _sign_in(client, "jobidvalidation@example.com")
    resp = client.get("/api/jobs/not-a-number")
    assert resp.status_code in (400, 404, 422)


def test_get_sources_is_public_and_merges_runs_with_job_counts(
    client: TestClient, migrated_database_url: str
):
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company)"
            " VALUES ('sources-test-a', 'x1', 'https://example.test/x1', 'Role', 'Acme')"
        )
        conn.execute(
            "INSERT INTO crawl_runs (source, status, jobs_found, jobs_new, finished_at)"
            " VALUES ('sources-test-a', 'ok', 1, 1, now())"
        )
        # A source with jobs but no crawl run must still show up.
        conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company)"
            " VALUES ('sources-test-b', 'y1', 'https://example.test/y1', 'Role', 'Acme')"
        )

    resp = client.get("/api/sources")
    assert resp.status_code == 200, resp.text
    by_source = {s["source"]: s for s in resp.json()}

    a = by_source["sources-test-a"]
    assert a["status"] == "ok"
    assert a["jobsFound"] == 1
    assert a["jobsNew"] == 1
    assert a["total"] == 1

    b = by_source["sources-test-b"]
    assert b["total"] == 1
    assert b["startedAt"] is not None


def test_put_preferences_updates_and_validates(client: TestClient):
    csrf = _sign_in(client, "prefsuser@example.com")
    resp = client.put(
        "/api/me/preferences",
        json={"keywords": ["python", "react"], "remoteOnly": True, "candidateCountry": "VN"},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 200
    assert resp.json()["preferences"]["keywords"] == ["python", "react"]
    # Omitted digest fields (M4-08) default rather than erroring, for older/simpler clients.
    assert resp.json()["preferences"]["digestEnabled"] is True
    assert resp.json()["preferences"]["digestHour"] == 7
    assert resp.json()["preferences"]["digestTz"] == "Asia/Ho_Chi_Minh"

    me = client.get("/api/me")
    assert me.json()["preferences"]["remoteOnly"] is True
    assert me.json()["preferences"]["candidateCountry"] == "VN"

    digest_resp = client.put(
        "/api/me/preferences",
        json={
            "keywords": ["python"],
            "remoteOnly": False,
            "candidateCountry": None,
            "digestEnabled": False,
            "digestHour": 20,
            "digestTz": "Australia/Sydney",
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert digest_resp.status_code == 200, digest_resp.text
    assert digest_resp.json()["preferences"]["digestEnabled"] is False
    assert digest_resp.json()["preferences"]["digestHour"] == 20
    assert digest_resp.json()["preferences"]["digestTz"] == "Australia/Sydney"

    bad_hour = client.put(
        "/api/me/preferences",
        json={
            "keywords": ["python"],
            "remoteOnly": False,
            "candidateCountry": None,
            "digestHour": 24,
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert bad_hour.status_code == 400

    bad_tz = client.put(
        "/api/me/preferences",
        json={
            "keywords": ["python"],
            "remoteOnly": False,
            "candidateCountry": None,
            "digestTz": "Not/A_Zone",
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert bad_tz.status_code == 400

    too_many_body = {
        "keywords": [f"k{i}" for i in range(31)],
        "remoteOnly": False,
        "candidateCountry": None,
    }
    too_many = client.put("/api/me/preferences", json=too_many_body, headers={"X-CSRF-Token": csrf})
    assert too_many.status_code == 400
