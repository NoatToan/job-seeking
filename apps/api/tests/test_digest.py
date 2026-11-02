"""Daily digest (M4-08): unsubscribe token (pure, no DB), job selection / scheduling against a
real (throwaway-schema) Postgres database, dry-run output, and the unsubscribe endpoint.
DB-backed tests are skipped with a clear message when `TEST_DATABASE_URL` is unset (see
conftest.py `migrated_database_url`).
"""

from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api import digest
from ujc_api.main import create_app
from ujc_api.settings import Settings


def _settings(database_url: str, **overrides) -> Settings:
    defaults = {
        "ujc_env": "test",
        "ujc_secret_key": "digest-test-secret",
        "ujc_public_url": "https://jobs.example.test",
    }
    defaults.update(overrides)
    return Settings(database_url=database_url, **defaults)


# --- unsubscribe_token / verify_unsubscribe_token: pure functions, no DB. -----------------------


def test_unsubscribe_token_roundtrips():
    settings = _settings("postgresql://unused/unused")
    token = digest.unsubscribe_token(settings, 42)
    assert digest.verify_unsubscribe_token(settings, 42, token)


def test_unsubscribe_token_rejects_wrong_user_or_tampered_token():
    settings = _settings("postgresql://unused/unused")
    token = digest.unsubscribe_token(settings, 42)
    assert not digest.verify_unsubscribe_token(settings, 43, token)
    assert not digest.verify_unsubscribe_token(settings, 42, token[:-1] + "0")


def test_unsubscribe_token_differs_with_secret_key():
    settings_a = _settings("postgresql://unused/unused", ujc_secret_key="a" * 32)
    settings_b = _settings("postgresql://unused/unused", ujc_secret_key="b" * 32)
    assert digest.unsubscribe_token(settings_a, 1) != digest.unsubscribe_token(settings_b, 1)


# --- DB-backed: due_users / select_digest_jobs / run_digest. ------------------------------------


def _insert_job(
    migrated_database_url: str, external_id: str, *, first_seen_at: datetime, **overrides
) -> int:
    fields = {
        "source": "digest-test",
        "external_id": external_id,
        "url": f"https://example.test/{external_id}",
        "title": "Senior Python Engineer",
        "company": "Acme",
        "remote": False,
        "description": "Build Python services.",
        "tags": ["python"],
        "first_seen_at": first_seen_at,
        **overrides,
    }
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO jobs"
            " (source, external_id, url, title, company, remote, description, tags, first_seen_at)"
            " VALUES (%(source)s, %(external_id)s, %(url)s, %(title)s, %(company)s,"
            " %(remote)s, %(description)s, %(tags)s, %(first_seen_at)s) RETURNING id",
            fields,
        ).fetchone()
    assert row is not None
    return row[0]


def _create_user(migrated_database_url: str, email: str, **prefs) -> int:
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO users (email) VALUES (%s) RETURNING id", (email,)
        ).fetchone()
        assert row is not None
        user_id = row[0]
        fields = {
            "user_id": user_id,
            "keywords": prefs.get("keywords", []),
            "remote_only": prefs.get("remote_only", False),
            "candidate_country": prefs.get("candidate_country"),
            "digest_enabled": prefs.get("digest_enabled", True),
            "digest_hour": prefs.get("digest_hour", 7),
            "digest_tz": prefs.get("digest_tz", "Asia/Ho_Chi_Minh"),
            "last_digest_at": prefs.get("last_digest_at"),
        }
        conn.execute(
            "INSERT INTO user_preferences"
            " (user_id, keywords, remote_only, candidate_country,"
            "  digest_enabled, digest_hour, digest_tz, last_digest_at)"
            " VALUES (%(user_id)s, %(keywords)s, %(remote_only)s, %(candidate_country)s,"
            " %(digest_enabled)s, %(digest_hour)s, %(digest_tz)s, %(last_digest_at)s)",
            fields,
        )
    return user_id


def test_due_users_respects_local_hour_and_dedupes_same_day(migrated_database_url: str):
    # 08:00 Asia/Ho_Chi_Minh (UTC+7) is 01:00 UTC; digest_hour=7 so this user is due.
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    due_id = _create_user(migrated_database_url, "due@example.com", digest_hour=7)
    # Their local hour hasn't passed 9 yet at this `now`.
    not_yet_id = _create_user(migrated_database_url, "notyet@example.com", digest_hour=9)
    # Already got one earlier today (their local day).
    already_id = _create_user(
        migrated_database_url,
        "already@example.com",
        digest_hour=7,
        last_digest_at=now - timedelta(hours=1),
    )
    disabled_id = _create_user(
        migrated_database_url, "disabled@example.com", digest_hour=7, digest_enabled=False
    )

    with psycopg.connect(migrated_database_url) as conn:
        due = digest.due_users(conn, now)

    due_ids = {u.id for u in due}
    assert due_id in due_ids
    assert not_yet_id not in due_ids
    assert already_id not in due_ids
    assert disabled_id not in due_ids


def test_due_users_handles_different_timezones_independently(migrated_database_url: str):
    # 23:30 Australia/Sydney (UTC+11 in Nov, no DST overlap issue here) is 12:30 UTC.
    now = datetime(2026, 11, 2, 12, 30, tzinfo=UTC)
    sydney_id = _create_user(
        migrated_database_url, "sydney@example.com", digest_hour=22, digest_tz="Australia/Sydney"
    )
    hcmc_id = _create_user(
        migrated_database_url, "hcmc@example.com", digest_hour=22, digest_tz="Asia/Ho_Chi_Minh"
    )

    with psycopg.connect(migrated_database_url) as conn:
        due = digest.due_users(conn, now)

    due_ids = {u.id for u in due}
    assert sydney_id in due_ids  # 23:30 local >= hour 22
    assert hcmc_id not in due_ids  # 19:30 local < hour 22


def test_select_digest_jobs_excludes_upwork_old_jobs_and_ranks_by_score(
    migrated_database_url: str,
):
    # A keyword unique to this test's jobs, so matching is scoped to them even though
    # `migrated_database_url` is session-scoped and other tests' jobs are also in the table.
    keyword = "pickytestxyz"
    user_id = _create_user(migrated_database_url, "picky@example.com", keywords=[keyword])
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    since = now - timedelta(hours=24)
    title = f"{keyword} Engineer"

    old_job = _insert_job(
        migrated_database_url, "old", first_seen_at=since - timedelta(hours=1), title=title
    )
    upwork_job = _insert_job(
        migrated_database_url, "upwork-job", first_seen_at=now, source="upwork", title=title
    )
    low_score_job = _insert_job(migrated_database_url, "low", first_seen_at=now, title=title)
    high_score_job = _insert_job(migrated_database_url, "high", first_seen_at=now, title=title)

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, status, profile)"
            " VALUES (%s, 'cv.txt', 'text/plain', 'x', 'done', '{}'::jsonb) RETURNING id",
            (user_id,),
        )
        cv_id = conn.execute("SELECT id FROM user_cvs WHERE user_id = %s", (user_id,)).fetchone()[0]
        for job_id, score in [(low_score_job, 40), (high_score_job, 90)]:
            conn.execute(
                "INSERT INTO user_matches (user_id, cv_id, job_id, score, summary)"
                " VALUES (%s, %s, %s, %s, 'ok')",
                (user_id, cv_id, job_id, score),
            )

    with psycopg.connect(migrated_database_url) as conn:
        jobs = digest.select_digest_jobs(conn, user_id, since)

    job_ids = [int(j["id"]) for j in jobs]
    assert old_job not in job_ids
    assert upwork_job not in job_ids
    assert job_ids == [high_score_job, low_score_job]


def test_select_digest_jobs_caps_at_max_jobs(migrated_database_url: str):
    user_id = _create_user(migrated_database_url, "lotsofjobs@example.com")
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    since = now - timedelta(hours=24)
    for i in range(digest.MAX_JOBS + 5):
        _insert_job(migrated_database_url, f"many-{i}", first_seen_at=now)

    with psycopg.connect(migrated_database_url) as conn:
        jobs = digest.select_digest_jobs(conn, user_id, since)

    assert len(jobs) == digest.MAX_JOBS


def test_run_digest_dry_run_does_not_send_or_mutate_state(migrated_database_url: str):
    # `migrated_database_url` is session-scoped, so `only_email` keeps this test's assertions
    # from being thrown off by due-every-hour (digest_hour=0) users other tests in this module
    # left behind in the same throwaway schema.
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    email = "dryrun@example.com"
    user_id = _create_user(migrated_database_url, email, digest_hour=0)
    _insert_job(migrated_database_url, "dry-run-job", first_seen_at=now)
    settings = _settings(migrated_database_url)

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        counts = digest.run_digest(conn, settings, dry_run=True, only_email=email, now=now)
        last_digest_at = conn.execute(
            "SELECT last_digest_at FROM user_preferences WHERE user_id = %s", (user_id,)
        ).fetchone()[0]

    assert counts["dry_run"] == 1
    assert last_digest_at is None


def test_run_digest_without_resend_key_logs_only_and_advances_last_digest_at(
    migrated_database_url: str,
):
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    email = "nokey@example.com"
    user_id = _create_user(migrated_database_url, email, digest_hour=0)
    _insert_job(migrated_database_url, "no-key-job", first_seen_at=now)
    settings = _settings(migrated_database_url)
    assert settings.resend_api_key is None

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        counts = digest.run_digest(conn, settings, only_email=email, now=now)
        last_digest_at = conn.execute(
            "SELECT last_digest_at FROM user_preferences WHERE user_id = %s", (user_id,)
        ).fetchone()[0]

    assert counts["logged_only"] == 1
    assert last_digest_at == now


def test_run_digest_skipped_empty_still_advances_last_digest_at(migrated_database_url: str):
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    email = "empty@example.com"
    # A keyword nothing in `jobs` matches (including jobs other tests in this session-scoped
    # schema may have left behind), so this user genuinely has nothing new.
    user_id = _create_user(
        migrated_database_url, email, digest_hour=0, keywords=["zzz-nonexistent-keyword"]
    )
    settings = _settings(migrated_database_url)

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        counts = digest.run_digest(conn, settings, only_email=email, now=now)
        last_digest_at = conn.execute(
            "SELECT last_digest_at FROM user_preferences WHERE user_id = %s", (user_id,)
        ).fetchone()[0]

    assert counts["skipped_empty"] == 1
    assert last_digest_at == now


def test_run_digest_user_filter_only_considers_that_email(migrated_database_url: str):
    now = datetime(2026, 11, 2, 1, 0, tzinfo=UTC)
    _create_user(migrated_database_url, "one@example.com", digest_hour=0)
    _create_user(migrated_database_url, "two@example.com", digest_hour=0)
    _insert_job(migrated_database_url, "filter-job", first_seen_at=now)
    settings = _settings(migrated_database_url)

    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        counts = digest.run_digest(conn, settings, only_email="one@example.com", now=now)

    assert counts["logged_only"] == 1


# --- `GET /api/digest/unsubscribe`. --------------------------------------------------------------


@pytest.fixture
def client(migrated_database_url: str):
    app = create_app(_settings(migrated_database_url))
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def test_unsubscribe_disables_digest_and_returns_html(
    client: TestClient, migrated_database_url: str
):
    user_id = _create_user(migrated_database_url, "unsub@example.com")
    settings = _settings(migrated_database_url)
    token = digest.unsubscribe_token(settings, user_id)

    resp = client.get("/api/digest/unsubscribe", params={"u": user_id, "t": token})

    assert resp.status_code == 200, resp.text
    assert "text/html" in resp.headers["content-type"]
    assert "unsubscribed" in resp.text.lower()

    with psycopg.connect(migrated_database_url) as conn:
        (enabled,) = conn.execute(
            "SELECT digest_enabled FROM user_preferences WHERE user_id = %s", (user_id,)
        ).fetchone()
    assert enabled is False


def test_unsubscribe_rejects_invalid_token(client: TestClient, migrated_database_url: str):
    user_id = _create_user(migrated_database_url, "badtoken@example.com")

    resp = client.get("/api/digest/unsubscribe", params={"u": user_id, "t": "not-a-real-token"})

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_token"

    with psycopg.connect(migrated_database_url) as conn:
        (enabled,) = conn.execute(
            "SELECT digest_enabled FROM user_preferences WHERE user_id = %s", (user_id,)
        ).fetchone()
    assert enabled is True
