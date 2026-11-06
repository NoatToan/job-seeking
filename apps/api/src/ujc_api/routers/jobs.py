"""`GET /api/jobs`, `GET /api/jobs/{id}` and `GET /api/sources` (docs/product/ARCHITECTURE.md §5).

The SPA's `getPublicJobs`/`getJob`/`getSources` (apps/web/src/lib/api.ts) call these;
`PublicJobsPage`/`JobDetail`/`SourceInfo` (packages/core/src/api.ts) are the response shapes.

`GET /api/jobs` and `GET /api/jobs/{id}` need no session: the public job catalogue (Slack request
"the home page should still show all the jobs we have without logging in"). Both accept an
*optional* session (`optional_user`) so a signed-in visitor's cookie is still honoured, but
neither currently changes its response based on it — there's nothing owner-scoped in `jobs`.
"""

from datetime import datetime
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from ujc_api.auth.deps import AuthedUser, optional_user
from ujc_api.cursor import InvalidCursor, decode_feed_cursor, encode_feed_cursor
from ujc_api.db import get_conn
from ujc_api.dto import (
    JOB_COLUMNS,
    JOB_DETAIL_COLUMNS,
    job_detail_dto,
    job_dto,
    job_sort_key,
    source_dto,
)

router = APIRouter(tags=["jobs"])

DEFAULT_LIMIT = 20
MAX_LIMIT = 50

# Upwork data is never written to `jobs` (docs/product/ARCHITECTURE.md §7), so this is a
# defensive belt-and-braces filter, not something that ever actually excludes a row today.
_EXCLUDED_SOURCES = "upwork"

# One row per `source` that has jobs and/or crawl runs. `latest_runs` keeps only the most recent
# `crawl_runs` row per source (`DISTINCT ON`); the `FULL OUTER JOIN` with `job_counts` means a
# source with jobs but no runs still gets a row (synthesised from its jobs: `status` defaults to
# 'ok' and `startedAt` falls back to the most recently first-seen job).
SOURCES_SQL = """
    WITH job_counts AS (
        SELECT source, count(*) AS total, max(first_seen_at) AS last_seen
        FROM jobs
        GROUP BY source
    ),
    latest_runs AS (
        SELECT DISTINCT ON (source) source, status, started_at, finished_at, jobs_found, jobs_new
        FROM crawl_runs
        ORDER BY source, started_at DESC
    )
    SELECT
        coalesce(j.source, r.source) AS source,
        coalesce(r.status, 'ok') AS status,
        coalesce(r.started_at, j.last_seen) AS started_at,
        r.finished_at AS finished_at,
        coalesce(r.jobs_found, j.total, 0) AS jobs_found,
        coalesce(r.jobs_new, 0) AS jobs_new,
        coalesce(j.total, 0) AS total
    FROM job_counts j
    FULL OUTER JOIN latest_runs r ON j.source = r.source
    ORDER BY source
"""


@router.get("/api/jobs")
def list_jobs(
    # Plain defaults (not `Query(default=...)`, unlike routers/feed.py): FastAPI still treats
    # these as query params for a GET route either way, but plain defaults mean the unit tests
    # below (test_jobs.py) can call `list_jobs(...)` directly with `fakes.FakeJobsConn`, the same
    # way `get_job`/`get_sources` already do, instead of only being exercisable via `TestClient`.
    cursor: str | None = None,
    limit: int = DEFAULT_LIMIT,
    q: str | None = None,
    source: str | None = None,
    remote: bool | None = None,
    user: AuthedUser | None = Depends(optional_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """The public job catalogue: every job we've crawled, newest first, no sign-in required. Same
    keyset cursor as `GET /api/feed` (routers/feed.py) — `{t, i}` over
    `(coalesce(posted_at, first_seen_at), id)` — just without the per-user keyword/eligibility
    filters (there's no signed-in user to personalise for; `user` is accepted but unused today)."""
    limit = max(1, min(limit, MAX_LIMIT))

    cursor_state: tuple[datetime, int] | None = None
    if cursor:
        try:
            cursor_state = decode_feed_cursor(cursor)
        except InvalidCursor as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "Invalid cursor"}
            ) from exc

    clauses: list[str] = ["source != %s"]
    params: list[Any] = [_EXCLUDED_SOURCES]

    if q:
        clauses.append("search @@ websearch_to_tsquery('english', %s)")
        params.append(q)

    if source:
        clauses.append("source = %s")
        params.append(source)

    if remote:
        clauses.append("remote = true")

    if cursor_state:
        cursor_t, cursor_i = cursor_state
        clauses.append("(coalesce(posted_at, first_seen_at), id) < (%s, %s)")
        params.append(cursor_t)
        params.append(cursor_i)

    where = " AND ".join(clauses)
    sql = (
        f"SELECT {JOB_COLUMNS} FROM jobs WHERE {where}"
        " ORDER BY coalesce(posted_at, first_seen_at) DESC, id DESC LIMIT %s"
    )
    rows = conn.execute(sql, [*params, limit + 1]).fetchall()
    has_more = len(rows) > limit
    page = rows[:limit]

    next_cursor = None
    if has_more and page:
        next_cursor = encode_feed_cursor(*job_sort_key(page[-1]))

    return {"items": [job_dto(r) for r in page], "nextCursor": next_cursor}


@router.get("/api/jobs/{job_id}")
def get_job(
    job_id: int,
    user: AuthedUser | None = Depends(optional_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    row = conn.execute(f"SELECT {JOB_DETAIL_COLUMNS} FROM jobs WHERE id = %s", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_detail_dto(row)


@router.get("/api/sources")
def get_sources(conn: psycopg.Connection = Depends(get_conn)) -> list[dict]:
    rows = conn.execute(SOURCES_SQL).fetchall()
    return [source_dto(r) for r in rows]
