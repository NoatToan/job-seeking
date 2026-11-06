"""Unit tests for `ujc_api.routers.jobs` against `FakeJobsConn` (no real Postgres)."""

from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeJobsConn
from fastapi import HTTPException

from ujc_api.auth.deps import AuthedUser
from ujc_api.routers.jobs import get_job, get_sources, list_jobs

USER = AuthedUser(id=1, email="person@example.com")


def _job(**overrides) -> dict:
    base = {
        "id": 1,
        "source": "weworkremotely",
        "url": "https://example.test/1",
        "title": "Senior Engineer",
        "company": "Acme",
        "first_seen_at": datetime(2026, 1, 1, tzinfo=UTC),
        "description": "Full job description.",
    }
    base.update(overrides)
    return base


def test_get_job_returns_job_detail_with_description():
    conn = FakeJobsConn(jobs=[_job()])
    body = get_job(1, user=USER, conn=conn)
    assert body["id"] == "1"
    assert body["title"] == "Senior Engineer"
    assert body["description"] == "Full job description."


def test_get_job_works_without_a_session_too():
    """`GET /api/jobs/{id}` is public: `optional_user` can be `None` (anonymous)."""
    conn = FakeJobsConn(jobs=[_job()])
    body = get_job(1, user=None, conn=conn)
    assert body["id"] == "1"


def test_get_job_missing_raises_404():
    conn = FakeJobsConn(jobs=[])
    with pytest.raises(HTTPException) as exc_info:
        get_job(999, user=USER, conn=conn)
    assert exc_info.value.status_code == 404


def test_list_jobs_is_public_and_newest_first():
    base = datetime(2026, 1, 1, tzinfo=UTC)
    conn = FakeJobsConn(
        jobs=[
            _job(id=1, title="Older", first_seen_at=base),
            _job(id=2, title="Newer", first_seen_at=base + timedelta(days=1)),
        ]
    )
    body = list_jobs(user=None, conn=conn)
    assert [item["title"] for item in body["items"]] == ["Newer", "Older"]
    assert body["nextCursor"] is None


def test_list_jobs_paginates_without_duplicates():
    base = datetime(2026, 1, 1, tzinfo=UTC)
    jobs = [
        _job(id=i, title=f"Job {i}", first_seen_at=base + timedelta(minutes=i)) for i in range(25)
    ]
    conn = FakeJobsConn(jobs=jobs)

    seen_ids: list[str] = []
    cursor = None
    for _ in range(10):
        body = list_jobs(cursor=cursor, limit=10, user=None, conn=conn)
        seen_ids.extend(item["id"] for item in body["items"])
        cursor = body["nextCursor"]
        if not cursor:
            break

    assert len(seen_ids) == 25
    assert len(seen_ids) == len(set(seen_ids))


def test_list_jobs_filters_by_q_source_and_remote():
    conn = FakeJobsConn(
        jobs=[
            _job(id=1, title="Backend Engineer", source="weworkremotely", remote=True),
            _job(id=2, title="Frontend Engineer", source="himalayas", remote=False),
            _job(id=3, title="Backend Architect", source="himalayas", remote=True),
        ]
    )

    by_q = list_jobs(q="Backend", user=None, conn=conn)
    assert {item["id"] for item in by_q["items"]} == {"1", "3"}

    by_source = list_jobs(source="himalayas", user=None, conn=conn)
    assert {item["id"] for item in by_source["items"]} == {"2", "3"}

    by_remote = list_jobs(remote=True, user=None, conn=conn)
    assert {item["id"] for item in by_remote["items"]} == {"1", "3"}


def test_list_jobs_never_includes_upwork():
    conn = FakeJobsConn(
        jobs=[
            _job(id=1, title="Freelance gig", source="upwork"),
            _job(id=2, title="Staff Engineer", source="weworkremotely"),
        ]
    )
    body = list_jobs(user=None, conn=conn)
    assert [item["id"] for item in body["items"]] == ["2"]


def test_get_sources_merges_runs_and_job_counts():
    conn = FakeJobsConn(
        jobs=[
            _job(id=1, source="weworkremotely"),
            _job(id=2, source="weworkremotely"),
            _job(id=3, source="himalayas", first_seen_at=datetime(2026, 2, 1, tzinfo=UTC)),
        ],
        crawl_runs=[
            {
                "source": "weworkremotely",
                "status": "ok",
                "started_at": datetime(2026, 1, 2, tzinfo=UTC),
                "finished_at": datetime(2026, 1, 2, 0, 5, tzinfo=UTC),
                "jobs_found": 2,
                "jobs_new": 1,
            }
        ],
    )

    body = get_sources(conn=conn)
    by_source = {s["source"]: s for s in body}

    wwr = by_source["weworkremotely"]
    assert wwr["status"] == "ok"
    assert wwr["jobsFound"] == 2
    assert wwr["jobsNew"] == 1
    assert wwr["total"] == 2
    assert wwr["finishedAt"] is not None

    # himalayas has jobs but no crawl_runs row: synthesised from its jobs.
    himalayas = by_source["himalayas"]
    assert himalayas["status"] == "ok"
    assert himalayas["total"] == 1
    assert himalayas["finishedAt"] is None
    assert himalayas["startedAt"] == "2026-02-01T00:00:00+00:00"


def test_get_sources_includes_a_source_with_only_a_crawl_run_and_no_jobs():
    conn = FakeJobsConn(
        crawl_runs=[
            {
                "source": "adzuna",
                "status": "error",
                "started_at": datetime(2026, 1, 5, tzinfo=UTC),
                "finished_at": datetime(2026, 1, 5, 0, 1, tzinfo=UTC),
                "jobs_found": 0,
                "jobs_new": 0,
            }
        ],
    )

    body = get_sources(conn=conn)
    assert len(body) == 1
    assert body[0]["source"] == "adzuna"
    assert body[0]["status"] == "error"
    assert body[0]["total"] == 0
