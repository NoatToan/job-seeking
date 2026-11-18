"""Job retention (`db.purge_old_jobs`, `db.upsert_jobs` skipping old postings) against a real
Postgres (TEST_DATABASE_URL, migrated with db/migrations). Skipped when unset. Every test runs in
a transaction that is rolled back."""

import os
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from job_crawler import db
from job_crawler.models import JobRecord


@pytest.fixture
def conn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(url) as connection, connection.transaction(force_rollback=True):
        yield connection


def insert(conn, external_id: str, posted_days_ago: int | None, first_seen_days_ago: int) -> int:
    row = conn.execute(
        "INSERT INTO jobs (source, external_id, url, title, company, posted_at, first_seen_at)"
        " VALUES ('retention-test', %s, 'https://example.test', 'Engineer', 'Acme',"
        " now() - make_interval(days => %s), now() - make_interval(days => %s)) RETURNING id",
        (external_id, posted_days_ago, first_seen_days_ago),
    ).fetchone()
    assert row is not None
    return row[0]


def remaining(conn) -> set[str]:
    rows = conn.execute("SELECT external_id FROM jobs WHERE source = 'retention-test'").fetchall()
    return {r[0] for r in rows}


def test_purge_deletes_jobs_past_retention_in_batches(conn):
    conn.execute("DELETE FROM jobs")  # only this test's rows count (rolled back)
    insert(conn, "old-1", 40, 40)
    insert(conn, "old-2", 31, 2)  # re-seen today, but posted over a month ago
    insert(conn, "old-3", None, 35)  # no posting date: aged by first_seen_at
    insert(conn, "recent", 5, 5)
    insert(conn, "undated-recent", None, 3)

    assert db.purge_old_jobs(conn, batch=2) == 3
    assert remaining(conn) == {"recent", "undated-recent"}


def test_purge_keeps_tracked_application_snapshot(conn):
    job_id = insert(conn, "applied", 60, 60)
    user = conn.execute(
        "INSERT INTO users (email) VALUES ('retention@example.test') RETURNING id"
    ).fetchone()
    assert user is not None
    conn.execute(
        "INSERT INTO applications (user_id, job_id, job_snapshot)"
        ' VALUES (%s, %s, \'{"title": "Engineer"}\')',
        (user[0], job_id),
    )

    db.purge_old_jobs(conn)

    row = conn.execute(
        "SELECT job_id, job_snapshot->>'title' FROM applications WHERE user_id = %s", (user[0],)
    ).fetchone()
    assert row == (None, "Engineer")


def test_upsert_skips_postings_past_retention(conn):
    now = datetime.now(UTC)
    jobs = [
        JobRecord(
            source="retention-test",
            external_id=external_id,
            url="https://example.test",
            title="Engineer",
            company="Acme",
            posted_at=now - timedelta(days=days),
        )
        for external_id, days in (("fresh", 1), ("stale", db.JOB_RETENTION_DAYS + 5))
    ]
    assert db.upsert_jobs(conn, jobs) == 1
    assert remaining(conn) == {"fresh"}
