"""Sections / level storage and the version-gated backfill against a real Postgres
(TEST_DATABASE_URL, migrated with db/migrations). Skipped when unset. Every test runs in a
transaction that is rolled back."""

import json
import os
from pathlib import Path

import psycopg
import pytest

from job_crawler import db, sections
from job_crawler.derived import parse_posting
from job_crawler.models import JobRecord

FIXTURE = Path(__file__).parent / "fixtures" / "jd_sample.json"
JOBS = json.loads(FIXTURE.read_text())["jobs"]


@pytest.fixture
def conn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(url) as connection:
        has_column = connection.execute(
            "SELECT 1 FROM information_schema.columns"
            " WHERE table_name = 'jobs' AND column_name = 'sections_version'"
        ).fetchone()
        if has_column is None:
            pytest.skip("jobs.sections missing: apply db/migrations first")
        with connection.transaction(force_rollback=True):
            # Only this test's rows are below the current version.
            connection.execute("UPDATE jobs SET sections_version = %s", (sections.VERSION,))
            yield connection


def record(job: dict, n: int) -> JobRecord:
    return JobRecord(
        source=job["source"],
        external_id=f"sections-test-{n}",
        url=f"https://example.test/{n}",
        title=job["title"],
        company=job["company"],
        description=job["description"],
        raw=job["raw"],
    )


def stored(conn, n: int) -> tuple:
    return conn.execute(
        "SELECT sections, sections_version, level, level_source FROM jobs WHERE external_id = %s",
        (f"sections-test-{n}",),
    ).fetchone()


PICKED = [JOBS[i] for i in (0, 9, 16, 27, 40)]


def test_upsert_writes_sections_and_level(conn):
    db.upsert_jobs(conn, [record(j, n) for n, j in enumerate(PICKED)])
    for n, job in enumerate(PICKED):
        found, version, level, level_source = stored(conn, n)
        expected = parse_posting(title=job["title"], description=job["description"], raw=job["raw"])
        assert version == sections.VERSION
        assert found == (expected["sections"].obj if expected["sections"] else None)
        assert (level, level_source) == (expected["level"], expected["level_source"])


def test_backfill_is_batched_idempotent_and_resumable(conn):
    db.upsert_jobs(conn, [record(j, n) for n, j in enumerate(PICKED)])
    ids = [f"sections-test-{n}" for n in range(len(PICKED))]
    # Rows as an older crawler left them: not parsed yet.
    conn.execute(
        "UPDATE jobs SET sections = NULL, sections_version = 0, level = NULL, level_source = NULL"
        " WHERE external_id = ANY(%s)",
        (ids,),
    )
    assert db.backfill_sections(conn, batch=2) == len(PICKED)
    first = [stored(conn, n) for n in range(len(PICKED))]
    assert all(row[1] == sections.VERSION for row in first)
    assert any(row[0] for row in first) and any(row[2] for row in first)

    # Idempotent: nothing is below the version any more.
    assert db.backfill_sections(conn, batch=2) == 0
    assert [stored(conn, n) for n in range(len(PICKED))] == first

    # Resumable: a run that stopped after one batch leaves the rest for the next run.
    conn.execute("UPDATE jobs SET sections_version = 0 WHERE external_id = ANY(%s)", (ids[:3],))
    assert db.backfill_sections(conn, batch=1) == 3
    assert [stored(conn, n) for n in range(len(PICKED))] == first


def test_a_rules_bump_reparses_every_row_and_never_goes_back(conn):
    db.upsert_jobs(conn, [record(j, n) for n, j in enumerate(PICKED)])
    newer = sections.VERSION + 1
    conn.execute("UPDATE jobs SET sections_version = %s", (sections.VERSION,))
    total = conn.execute("SELECT count(*) FROM jobs").fetchone()[0]
    assert db.backfill_sections(conn, batch=500, version=newer) == total
    assert {stored(conn, n)[1] for n in range(len(PICKED))} == {newer}
    # Older code (the current VERSION) leaves rows written by newer rules alone.
    assert db.backfill_sections(conn) == 0
