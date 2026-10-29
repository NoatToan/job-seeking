"""`GET /api/feed` — jobs already in our DB, keyset-paginated (docs/product/FLOW_V2.md §3, §4)."""

from datetime import datetime
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from job_crawler import eligibility

from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.cursor import InvalidCursor, decode_feed_cursor, encode_feed_cursor
from ujc_api.db import get_conn
from ujc_api.dto import JOB_COLUMNS, job_dto

router = APIRouter(prefix="/api/feed", tags=["feed"])

DEFAULT_LIMIT = 20
MAX_LIMIT = 50


def _accepted_tokens(candidate_country: str | None) -> list[str]:
    """Open-to tokens that make a remote job eligible for this candidate (or just WORLDWIDE when
    they haven't set a country)."""
    if not candidate_country:
        return [eligibility.WORLDWIDE]
    regions = eligibility.COUNTRY_REGIONS.get(candidate_country, [])
    return [eligibility.WORLDWIDE, candidate_country, *regions]


def _sort_key(row: tuple) -> tuple[datetime, int]:
    posted_at, first_seen_at = row[-2], row[-1]
    return (posted_at or first_seen_at), row[0]


@router.get("")
def get_feed(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT),
    q: str | None = Query(default=None),
    source: str | None = Query(default=None),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))

    cursor_state: tuple[datetime, int] | None = None
    if cursor:
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

    clauses: list[str] = []
    params: list[Any] = []

    if keywords:
        tsquery = " || ".join(["websearch_to_tsquery('english', %s)"] * len(keywords))
        clauses.append(f"search @@ ({tsquery})")
        params.extend(keywords)

    if remote_only:
        clauses.append("remote = true")

    clauses.append("(NOT remote OR open_to IS NULL OR open_to && %s)")
    params.append(_accepted_tokens(candidate_country))

    if q:
        clauses.append("search @@ websearch_to_tsquery('english', %s)")
        params.append(q)

    if source:
        clauses.append("source = %s")
        params.append(source)

    if cursor_state:
        cursor_t, cursor_i = cursor_state
        clauses.append("(coalesce(posted_at, first_seen_at), id) < (%s, %s)")
        params.append(cursor_t)
        params.append(cursor_i)

    where = " AND ".join(clauses) if clauses else "TRUE"
    sql = (
        f"SELECT {JOB_COLUMNS} FROM jobs WHERE {where}"
        " ORDER BY coalesce(posted_at, first_seen_at) DESC, id DESC LIMIT %s"
    )
    params.append(limit + 1)

    rows = conn.execute(sql, params).fetchall()
    has_more = len(rows) > limit
    page = rows[:limit]

    next_cursor = None
    if has_more and page:
        ts, job_id = _sort_key(page[-1])
        next_cursor = encode_feed_cursor(ts, job_id)

    return {
        "items": [job_dto(r) for r in page],
        "nextCursor": next_cursor,
        "keywords": keywords,
    }
