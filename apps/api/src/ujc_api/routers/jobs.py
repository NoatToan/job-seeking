"""`GET /api/jobs`, `GET /api/jobs/{id}` and `GET /api/sources` (docs/product/ARCHITECTURE.md §5).

The SPA's `getPublicJobs`/`getJob`/`getSources` (apps/web/src/lib/api.ts) call these;
`PublicJobsPage`/`JobDetail`/`SourceInfo` (packages/core/src/api.ts) are the response shapes.

`GET /api/jobs` and `GET /api/jobs/{id}` need no session: the public job catalogue (Slack request
"the home page should still show all the jobs we have without logging in"). Both accept an
*optional* session (`optional_user`) so a signed-in visitor's cookie is still honoured, but
neither currently changes its response based on it — there's nothing owner-scoped in `jobs`.
"""

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from ujc_api.auth.deps import AuthedUser, optional_user
from ujc_api.db import get_conn
from ujc_api.dto import (
    JOB_COLUMNS,
    JOB_DETAIL_COLUMNS,
    job_detail_dto,
    job_dto,
    source_dto,
)
from ujc_api.feed_query import (
    COUNTRY_CLAUSE,
    TECH_CLAUSE,
    access_clause,
    parse_tech,
    posted_within_clause,
)
from ujc_api.job_sort import PUBLIC_SORTS, fetch_page, resolve_sort
from ujc_api.job_votes import (
    HIDE_REPORTED_CLAUSE,
    STATS_COLUMN_COUNT,
    STATS_COLUMNS,
    STATS_JOIN,
    community_dto,
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
    country: str | None = None,
    tech: str | None = None,
    days: int | None = None,
    hours: int | None = None,
    access: str | None = None,
    based_in: str | None = None,
    sort: str | None = None,
    tz: str | None = None,
    hide_reported: bool = False,
    user: AuthedUser | None = Depends(optional_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """The public job catalogue: every job we've crawled, no sign-in required, newest first unless
    `sort` says otherwise (`newest` | `timezone` (+ `tz`, the viewer's IANA zone) | `salary`; see
    ujc_api.job_sort). Same keyset cursors as `GET /api/feed` (routers/feed.py), just without the
    per-user keyword/eligibility filters (`user` is accepted but unused today). Each job carries
    `community` (ujc_api.job_votes); `hide_reported` drops jobs the community flagged."""
    limit = max(1, min(limit, MAX_LIMIT))
    plan = resolve_sort(sort, tz, allowed=PUBLIC_SORTS)

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

    if country:
        clauses.append(COUNTRY_CLAUSE)
        params.append(country.upper())

    if tech_ids := parse_tech(tech):
        clauses.append(TECH_CLAUSE)
        params.append(tech_ids)

    if region := access_clause(access, based_in):
        clauses.append(region[0])
        params.append(region[1])

    if posted := posted_within_clause(days, hours):
        clauses.append(posted[0])
        params.append(posted[1])

    if hide_reported:
        clauses.append(HIDE_REPORTED_CLAUSE)

    page, next_cursor = fetch_page(
        conn,
        plan,
        cursor,
        columns=f"{JOB_COLUMNS}, {STATS_COLUMNS}",
        from_sql=f"jobs {STATS_JOIN}",
        from_params=[],
        clauses=clauses,
        where_params=params,
        limit=limit,
    )
    return {"items": [job_dto_with_community(r) for r in page], "nextCursor": next_cursor}


def job_dto_with_community(row: tuple) -> dict:
    """A `JOB_COLUMNS` row followed by `job_votes.STATS_COLUMNS` -> `Job` + `community` (the
    aggregate every viewer sees; never the viewer's own vote, so the payload stays cacheable)."""
    dto = job_dto(tuple(row[:-STATS_COLUMN_COUNT]))
    dto["community"] = community_dto(tuple(row[-STATS_COLUMN_COUNT:]))
    return dto


# Declared before `/api/jobs/{job_id}` so "facets" isn't parsed as a job id.
@router.get("/api/jobs/facets")
def get_job_facets(conn: psycopg.Connection = Depends(get_conn)) -> dict:
    """Filter options with job counts, most common first: `countries` (ISO codes from
    `jobs.countries`) and `tech` (ids from `jobs.tech_stack`). Public, like the catalogue."""
    rows = conn.execute(
        "SELECT c, count(*) FROM jobs, unnest(countries) AS c"
        " WHERE source != %s GROUP BY c ORDER BY count(*) DESC, c",
        (_EXCLUDED_SOURCES,),
    ).fetchall()
    tech_rows = conn.execute(
        "SELECT t, count(*) FROM jobs, unnest(tech_stack) AS t"
        " WHERE source != %s GROUP BY t ORDER BY count(*) DESC, t",
        (_EXCLUDED_SOURCES,),
    ).fetchall()
    return {
        "countries": [{"code": code, "count": count} for code, count in rows],
        "tech": [{"id": tech_id, "count": count} for tech_id, count in tech_rows],
    }


@router.get("/api/jobs/{job_id}")
def get_job(
    job_id: int,
    user: AuthedUser | None = Depends(optional_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    row = conn.execute(
        f"SELECT {JOB_DETAIL_COLUMNS}, {STATS_COLUMNS} FROM jobs {STATS_JOIN} WHERE jobs.id = %s",
        (job_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    dto = job_detail_dto(tuple(row[:-STATS_COLUMN_COUNT]))
    dto["community"] = community_dto(tuple(row[-STATS_COLUMN_COUNT:]))
    return dto


@router.get("/api/sources")
def get_sources(conn: psycopg.Connection = Depends(get_conn)) -> list[dict]:
    rows = conn.execute(SOURCES_SQL).fetchall()
    return [source_dto(r) for r in rows]
