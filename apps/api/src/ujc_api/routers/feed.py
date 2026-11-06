"""`GET /api/feed` — jobs already in our DB, keyset-paginated (docs/product/FLOW_V2.md §3, §4)."""

from datetime import datetime
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from ujc_api.auth.deps import AuthedUser, require_jobs_read
from ujc_api.cursor import InvalidCursor, decode_feed_cursor, encode_feed_cursor
from ujc_api.db import get_conn
from ujc_api.dto import JOB_COLUMNS, job_dto, job_sort_key
from ujc_api.feed_query import feed_filter_clauses

router = APIRouter(prefix="/api/feed", tags=["feed"])

DEFAULT_LIMIT = 20
MAX_LIMIT = 50
MAX_SCORE_SORT_LIMIT = 50


def _job_dto_with_match(row: tuple) -> dict[str, Any]:
    """`row` is a `JOB_COLUMNS` row plus `(score, summary, missing_skills)` from a `user_matches`
    LEFT JOIN. `match` is `None` when this job has no score for the current user yet."""
    *job_row, score, summary, missing_skills = row
    dto = job_dto(tuple(job_row))
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
    user: AuthedUser = Depends(require_jobs_read),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    by_score = sort == "score"

    cursor_state: tuple[datetime, int] | None = None
    if cursor and not by_score:
        try:
            cursor_state = decode_feed_cursor(cursor)
        except InvalidCursor as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "Invalid cursor"}
            ) from exc

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

    if cursor_state:
        cursor_t, cursor_i = cursor_state
        clauses.append("(coalesce(posted_at, first_seen_at), id) < (%s, %s)")
        where_params.append(cursor_t)
        where_params.append(cursor_i)

    if by_score:
        clauses.append("um.score IS NOT NULL")

    where = " AND ".join(clauses) if clauses else "TRUE"
    select = f"SELECT {JOB_COLUMNS}, um.score, um.summary, um.missing_skills FROM jobs"
    join = "LEFT JOIN user_matches um ON um.user_id = %s AND um.job_id = jobs.id"
    order = (
        "um.score DESC, jobs.id DESC"
        if by_score
        else "coalesce(posted_at, first_seen_at) DESC, jobs.id DESC"
    )
    page_limit = min(limit, MAX_SCORE_SORT_LIMIT) if by_score else limit + 1
    sql = f"{select} {join} WHERE {where} ORDER BY {order} LIMIT %s"
    params = [user.id, *where_params, page_limit]

    rows = conn.execute(sql, params).fetchall()
    has_more = not by_score and len(rows) > limit
    page = rows[:limit]

    next_cursor = None
    if has_more and page:
        ts, job_id = job_sort_key(page[-1])
        next_cursor = encode_feed_cursor(ts, job_id)

    return {
        "items": [_job_dto_with_match(r) for r in page],
        "nextCursor": next_cursor,
        "keywords": keywords,
    }
