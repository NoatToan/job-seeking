"""End-to-end `match_score` / `POST /api/matches/refresh` / `GET /api/feed` match flows against
a real (throwaway-schema) Postgres database. Skipped with a clear message when
`TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`)."""

import psycopg
import pytest
from fastapi.testclient import TestClient
from job_crawler.matching.cv import CvText
from job_crawler.matching.scorer import MatchResult

from ujc_api import worker
from ujc_api.auth.csrf import generate_csrf_token
from ujc_api.auth.session import create_session
from ujc_api.main import create_app
from ujc_api.settings import Settings


def _settings(migrated_database_url: str) -> Settings:
    return Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="matches-test-secret",
        ujc_otp_review_mode=True,
    )


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(_settings(migrated_database_url))
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, migrated_database_url: str, email: str) -> str:
    """Logs `client` in directly through the DB (insert user, create a session row, set the
    session+CSRF cookies), bypassing `POST /api/auth/otp` so these tests don't compete for the
    process-wide 20-per-IP-per-hour OTP rate limit with every other DB-backed test module."""
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO users (email) VALUES (%s)"
            " ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
            (email,),
        ).fetchone()
        assert row is not None
        token = create_session(conn, row[0])
    csrf = generate_csrf_token()
    client.cookies.set("ujc_session", token)
    client.cookies.set("ujc_csrf", csrf)
    return csrf


def _insert_job(migrated_database_url: str, external_id: str, **overrides) -> int:
    fields = {
        "source": "matches-test",
        "external_id": external_id,
        "url": f"https://example.test/{external_id}",
        "title": "Senior Python Engineer",
        "company": "Acme",
        "remote": False,
        "description": "Build Python services.",
        "tags": ["Python"],
        **overrides,
    }
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, remote, description, tags)"
            " VALUES (%(source)s, %(external_id)s, %(url)s, %(title)s, %(company)s,"
            " %(remote)s, %(description)s, %(tags)s) RETURNING id",
            fields,
        ).fetchone()
    assert row is not None
    return row[0]


def _user_id(migrated_database_url: str, email: str) -> int:
    with psycopg.connect(migrated_database_url) as conn:
        row = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
    assert row is not None
    return row[0]


def _run_match_score(migrated_database_url: str, user_id: int, *, score: int = 88) -> None:
    """Drains one `match_score` task for `user_id` with a deterministic fake scorer (no `claude`
    CLI, no network)."""

    def fake_score_jobs(profile, preferences, jobs):
        return [
            MatchResult(
                job_id=j.id, score=score, summary="Great fit", reasons=["a"], missing_skills=["k8s"]
            )
            for j in jobs
        ]

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        for _ in range(50):
            (status,) = conn.execute(
                "SELECT status FROM tasks WHERE kind = 'match_score'"
                " AND payload->>'user_id' = %s ORDER BY id DESC LIMIT 1",
                (str(user_id),),
            ).fetchone()
            if status == "done":
                return
            assert worker.run_once(conn, worker="match-test-worker", score_jobs_fn=fake_score_jobs)


def test_cv_extract_then_refresh_produces_scored_matches_on_the_feed(
    client: TestClient, migrated_database_url: str
):
    job_id = _insert_job(migrated_database_url, "match-1")
    csrf = _sign_in(client, migrated_database_url, "matcher@example.com")
    user_id = _user_id(migrated_database_url, "matcher@example.com")

    resp = client.post(
        "/api/cvs",
        files={"file": ("cv.txt", b"Senior Python engineer, Postgres, Docker", "text/plain")},
        headers={"X-CSRF-Token": csrf},
    )
    cv_id = int(resp.json()["id"])

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        for _ in range(50):
            (status,) = conn.execute(
                "SELECT status FROM user_cvs WHERE id = %s", (cv_id,)
            ).fetchone()
            if status != "queued":
                break
            worker.run_once(
                conn,
                worker="cv-test-worker",
                extract_text_fn=lambda _p: CvText(text="Senior Python engineer", ocr_used=False),
                extract_profile_fn=lambda _t: {
                    "search_keywords": ["python"],
                    "skills": ["Python"],
                    "location": "Remote",
                },
            )

    # cv_extract auto-enqueues match_score; drain it with a deterministic fake scorer.
    _run_match_score(migrated_database_url, user_id, score=88)

    feed = client.get("/api/feed", params={"source": "matches-test"})
    assert feed.status_code == 200, feed.text
    item = next(i for i in feed.json()["items"] if i["id"] == str(job_id))
    assert item["match"] == {"score": 88, "summary": "Great fit", "missingSkills": ["k8s"]}

    sorted_resp = client.get("/api/feed", params={"sort": "score", "source": "matches-test"})
    assert sorted_resp.status_code == 200, sorted_resp.text
    assert sorted_resp.json()["nextCursor"] is None
    assert [i["id"] for i in sorted_resp.json()["items"]] == [str(job_id)]
    assert sorted_resp.json()["items"][0]["match"]["score"] == 88


def test_refresh_requires_csrf_and_enforces_daily_quota(
    client: TestClient, migrated_database_url: str
):
    _insert_job(migrated_database_url, "match-quota-1")
    csrf = _sign_in(client, migrated_database_url, "quotauser@example.com")

    no_csrf = client.post("/api/matches/refresh")
    assert no_csrf.status_code == 403

    for _ in range(3):
        ok = client.post("/api/matches/refresh", headers={"X-CSRF-Token": csrf})
        assert ok.status_code == 202, ok.text
        assert "taskId" in ok.json()

    blocked = client.post("/api/matches/refresh", headers={"X-CSRF-Token": csrf})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "quota_exceeded"


def test_feed_match_is_owner_scoped(client: TestClient, migrated_database_url: str):
    job_id = _insert_job(migrated_database_url, "match-owner-1")
    csrf1 = _sign_in(client, migrated_database_url, "matchowner@example.com")
    owner_id = _user_id(migrated_database_url, "matchowner@example.com")

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, status, profile)"
            " VALUES (%s, 'cv.txt', 'text/plain', 'x', 'done', '{}'::jsonb)",
            (owner_id,),
        )

    client.post("/api/matches/refresh", headers={"X-CSRF-Token": csrf1})
    _run_match_score(migrated_database_url, owner_id, score=70)

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf1})
    _sign_in(client, migrated_database_url, "matchintruder@example.com")

    feed = client.get("/api/feed", params={"source": "matches-test"})
    item = next(i for i in feed.json()["items"] if i["id"] == str(job_id))
    assert item["match"] is None  # this match belongs to another user
