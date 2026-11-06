"""`GET /api/feed` — jobs already in our DB, keyset-paginated (docs/product/FLOW_V2.md §3, §4)."""

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Query

from ujc_api.auth.deps import AuthedUser, require_jobs_read
from ujc_api.db import get_conn
from ujc_api.dto import JOB_COLUMNS, job_dto
from ujc_api.feed_query import (
    COUNTRY_CLAUSE,
    TECH_CLAUSE,
    access_clause,
    feed_filter_clauses,
    parse_tech,
    posted_within_clause,
)
from ujc_api.job_sort import FEED_SORTS, fetch_page, resolve_sort
from ujc_api.job_votes import (
    HIDE_REPORTED_CLAUSE,
    STATS_COLUMN_COUNT,
    STATS_COLUMNS,
    STATS_JOIN,
    community_dto,
)

router = APIRouter(prefix="/api/feed", tags=["feed"])

DEFAULT_LIMIT = 20
MAX_LIMIT = 50


def _job_dto_with_match(row: tuple) -> dict[str, Any]:
    """`row` is a `JOB_COLUMNS` row plus `(score, summary, missing_skills)` from a `user_matches`
    LEFT JOIN and `job_votes.STATS_COLUMNS`. `match` is `None` when this job has no score for the
    current user yet."""
    stats = tuple(row[-STATS_COLUMN_COUNT:])
    *job_row, score, summary, missing_skills = row[:-STATS_COLUMN_COUNT]
    dto = job_dto(tuple(job_row))
    dto["community"] = community_dto(stats)
    dto["match"] = (
        {"score": score, "summary": summary, "missingSkills": list(missing_skills or [])}
        if score is not None
        else None
    )
    return dto


@router.get("")
def get_feed(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT),
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    sort: str | None = Query(default=None),
    country: str | None = Query(default=None),
    tech: str | None = Query(default=None),
    days: int | None = Query(default=None),
    hours: int | None = Query(default=None),
    access: str | None = Query(default=None),
    based_in: str | None = Query(default=None),
    tz: str | None = Query(default=None),
    hide_reported: bool = Query(default=False),
    user: AuthedUser = Depends(require_jobs_read),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    """The signed-in feed. `sort`: `newest` (default) | `timezone` (+ `tz`) | `salary` | `match`
    (CV match score, unscored jobs last; `score` is the old name). See ujc_api.job_sort."""
    limit = max(1, min(limit, MAX_LIMIT))
    plan = resolve_sort(sort, tz, allowed=FEED_SORTS)

    prefs_row = conn.execute(
        "SELECT keywords, remote_only, candidate_country FROM user_preferences WHERE user_id = %s",
        (user.id,),
    ).fetchone()
    keywords: list[str] = list(prefs_row[0]) if prefs_row else []
    remote_only: bool = bool(prefs_row[1]) if prefs_row else False
    candidate_country: str | None = prefs_row[2] if prefs_row else None

    clauses, where_params = feed_filter_clauses(keywords, remote_only, candidate_country)

    if q:
        clauses.append("search @@ websearch_to_tsquery('english', %s)")
        where_params.append(q)

    if source:
        clauses.append("source = %s")
        where_params.append(source)

    if country:
        clauses.append(COUNTRY_CLAUSE)
        where_params.append(country.upper())

    if tech_ids := parse_tech(tech):
        clauses.append(TECH_CLAUSE)
        where_params.append(tech_ids)

    if region := access_clause(access, based_in):
        clauses.append(region[0])
        where_params.append(region[1])

    if posted := posted_within_clause(days, hours):
        clauses.append(posted[0])
        where_params.append(posted[1])

    if hide_reported:
        clauses.append(HIDE_REPORTED_CLAUSE)

    page, next_cursor = fetch_page(
        conn,
        plan,
        cursor,
        columns=f"{JOB_COLUMNS}, um.score, um.summary, um.missing_skills, {STATS_COLUMNS}",
        from_sql="jobs LEFT JOIN user_matches um ON um.user_id = %s AND um.job_id = jobs.id"
        f" {STATS_JOIN}",
        from_params=[user.id],
        clauses=clauses,
        where_params=where_params,
        limit=limit,
    )

    return {
        "items": [_job_dto_with_match(r) for r in page],
        "nextCursor": next_cursor,
        "keywords": keywords,
    }
