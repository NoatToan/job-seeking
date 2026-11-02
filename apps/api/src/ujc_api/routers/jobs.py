"""`GET /api/jobs/{id}` and `GET /api/sources` (docs/product/ARCHITECTURE.md §5).

The SPA's `getJob`/`getSources` (apps/web/src/lib/api.ts) call these; `JobDetail`/`SourceInfo`
(packages/core/src/api.ts) are the response shapes.
"""

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.dto import JOB_DETAIL_COLUMNS, job_detail_dto, source_dto

router = APIRouter(tags=["jobs"])

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


@router.get("/api/jobs/{job_id}")
def get_job(
    job_id: int,
    user: AuthedUser = Depends(current_user),
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
