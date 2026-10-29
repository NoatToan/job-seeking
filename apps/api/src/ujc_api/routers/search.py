"""`GET /api/search/live` (docs/product/FLOW_V2.md §3-4)."""

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from job_crawler.models import JobRecord
from starlette.concurrency import run_in_threadpool

from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.cursor import (
    SEARCH_SOURCE_IDS,
    InvalidCursor,
    decode_search_cursor,
    encode_search_cursor,
)
from ujc_api.db import get_conn
from ujc_api.dto import JOB_COLUMNS, job_dto
from ujc_api.jobs_upsert import upsert_jobs_get_ids
from ujc_api.search_sources import merge_live_search

router = APIRouter(prefix="/api/search", tags=["search"])

DEFAULT_LIMIT = 20


def _write_and_fetch_rows(conn: psycopg.Connection, records: list[JobRecord]) -> list[tuple]:
    """Upserts `records` into `jobs` and returns their full, freshly-written rows (so `open_to`
    etc. reflect what `job_crawler.db.upsert_jobs` just derived), in `records` order."""
    ids_by_key = upsert_jobs_get_ids(conn, records)
    ordered_ids: list[int] = []
    seen: set[int] = set()
    for record in records:
        job_id = ids_by_key.get((record.source, record.external_id))
        if job_id is not None and job_id not in seen:
            ordered_ids.append(job_id)
            seen.add(job_id)
    if not ordered_ids:
        return []
    rows = conn.execute(
        f"SELECT {JOB_COLUMNS} FROM jobs WHERE id = ANY(%s)", (ordered_ids,)
    ).fetchall()
    rows_by_id = {row[0]: row for row in rows}
    return [rows_by_id[i] for i in ordered_ids if i in rows_by_id]


@router.get("/live")
async def live_search(
    q: str = Query(default=""),
    sources: str = Query(default=",".join(SEARCH_SOURCE_IDS)),
    cursor: str | None = Query(default=None),
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    requested = [s.strip() for s in sources.split(",") if s.strip()]
    requested = [s for s in requested if s in SEARCH_SOURCE_IDS] or list(SEARCH_SOURCE_IDS)

    cursor_state: dict[str, int | None] = {}
    if cursor:
        try:
            cursor_state = decode_search_cursor(cursor)
        except InvalidCursor as exc:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_cursor", "message": "Invalid cursor"}
            ) from exc

    records, next_state, statuses = await merge_live_search(
        q, requested, cursor_state, limit=DEFAULT_LIMIT
    )

    rows = await run_in_threadpool(_write_and_fetch_rows, conn, records)

    exhausted = all(next_state.get(s) is None for s in requested)
    next_cursor = None if exhausted else encode_search_cursor(next_state)

    return {
        "items": [job_dto(r) for r in rows],
        "nextCursor": next_cursor,
        "sources": statuses,
    }
