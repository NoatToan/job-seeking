"""Sort options for the job lists: `GET /api/jobs` (routers/jobs.py) and `GET /api/feed`
(routers/feed.py). See docs/DECISIONS.md "Job list sort options".

- `newest` (default): `coalesce(posted_at, first_seen_at)` — the board's own date when it gave one,
  else when we first saw the job. Keyset `(t, id)`, cursor `{t, i}` (unchanged from before sorts).
- `timezone`: how many whole hours the job's 09:00–17:00 is off the viewer's own 09:00–17:00 (the
  web's `workHoursFit`, apps/web/src/lib/work-hours.ts: smallest gap across the job's zones, on a
  24h circle). Needs `tz` (the viewer's IANA zone). Jobs with no known zone come last.
- `salary`: `jobs.salary_usd_year` (migration 025: top of the range, per year, rough USD). Jobs
  with no comparable salary come last.
- `match` (feed only): the viewer's CV match score (`user_matches.score`); unscored jobs last.

Every keyed sort orders by `(key DESC, t DESC, id DESC)` with `key` an integer that is never NULL
(a sentinel puts "unknown" last), so one row comparison `(key, t, id) < (...)` pages it without
duplicates or gaps; ties fall back to newest first. Keyed cursors are `{s, k, t, i}` and only
valid for the sort `s` they were issued for.
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

import psycopg
from fastapi import HTTPException

from ujc_api.cursor import (
    InvalidCursor,
    decode_feed_cursor,
    decode_sort_cursor,
    encode_feed_cursor,
    encode_sort_cursor,
)
from ujc_api.dto import job_sort_key

NEWEST = "newest"
TIMEZONE = "timezone"
SALARY = "salary"
MATCH = "match"
PUBLIC_SORTS = (NEWEST, TIMEZONE, SALARY)
FEED_SORTS = (*PUBLIC_SORTS, MATCH)
# `GET /api/feed?sort=score` predates the sort options (the "Best matches" toggle).
_ALIASES = {"score": MATCH}

#: Posted date, else first seen: the newest-first key and every sort's tie-breaker.
TIME_SQL = "coalesce(posted_at, first_seen_at)"
#: Sentinel keys that put "unknown" after every real value (all keys sort descending).
_UNKNOWN_SALARY = -1
_UNKNOWN_SCORE = -1
_UNKNOWN_ZONE = -99
_DAY = 24 * 60

_FIXED_OFFSET_STEP = 15  # minutes; the crawler writes "UTC±hh:mm"


@dataclass(frozen=True)
class SortPlan:
    name: str
    #: SQL for the integer key (None for newest); may reference `jobs` and, in the feed, `um`.
    key_sql: str | None = None
    key_params: list[Any] = field(default_factory=list)


def _bad_request(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": code, "message": message})


def _offset_minutes(zone: str, at: datetime) -> int | None:
    """Minutes east of UTC for an IANA name or a "UTC±hh:mm" offset, at `at`; None if unknown."""
    if zone.startswith("UTC") and len(zone) == 9 and zone[3] in "+-" and zone[6] == ":":
        try:
            minutes = int(zone[4:6]) * 60 + int(zone[7:9])
        except ValueError:
            return None
        return minutes if zone[3] == "+" else -minutes
    try:
        offset = at.astimezone(ZoneInfo(zone)).utcoffset()
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return int(offset.total_seconds() // 60) if offset is not None else None


def _fixed_offset_names() -> list[str]:
    names = []
    for minutes in range(-12 * 60, 14 * 60 + 1, _FIXED_OFFSET_STEP):
        sign = "-" if minutes < 0 else "+"
        h, m = divmod(abs(minutes), 60)
        names.append(f"UTC{sign}{h:02d}:{m:02d}")
    return names


@lru_cache(maxsize=1)
def _known_zones() -> tuple[str, ...]:
    return (*sorted(available_timezones()), *_fixed_offset_names())


def _gap_hours(user_offset: int, job_offset: int) -> int:
    """Whole hours between two 9–5 days on a 24h circle (0 = same hours, 12 = opposite)."""
    diff = abs(user_offset - job_offset) % _DAY
    return min(diff, _DAY - diff) // 60


@lru_cache(maxsize=4)
def _zone_offsets(hour: datetime) -> tuple[tuple[str, int], ...]:
    """(zone, UTC offset in minutes) at `hour` for every known zone. ~50 ms to build, so cached
    per hour (DST changes on the hour)."""
    pairs = ((zone, _offset_minutes(zone, hour)) for zone in _known_zones())
    return tuple((zone, offset) for zone, offset in pairs if offset is not None)


def zone_gaps(user_offset: int, at: datetime) -> dict[str, int]:
    """{zone: gap in whole hours} for every zone the crawler may store (IANA + fixed offsets),
    DST-aware at `at` — passed to SQL as one jsonb lookup, so the per-row work is a key lookup."""
    hour = at.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    return {zone: _gap_hours(user_offset, offset) for zone, offset in _zone_offsets(hour)}


def resolve_sort(
    sort: str | None, tz: str | None, *, allowed: tuple[str, ...], now: datetime | None = None
) -> SortPlan:
    """Validates `sort` (+ `tz` for the time-zone sort) and returns its SQL plan, or raises 400."""
    name = _ALIASES.get(sort or "", sort or NEWEST)
    if name not in allowed:
        raise _bad_request("invalid_sort", f"sort must be one of: {', '.join(allowed)}")
    if name == NEWEST:
        return SortPlan(NEWEST)
    if name == SALARY:
        return SortPlan(SALARY, f"coalesce(jobs.salary_usd_year, {_UNKNOWN_SALARY})")
    if name == MATCH:
        return SortPlan(MATCH, f"coalesce(um.score, {_UNKNOWN_SCORE})")
    at = now or datetime.now(UTC)
    user_offset = _offset_minutes(tz, at) if tz else None
    if user_offset is None:
        raise _bad_request("invalid_timezone", "sort=timezone needs tz, an IANA time zone name")
    # Smaller gap = better, and keys sort descending: negate. Zones we can't place are ignored;
    # a job with none known gets the sentinel.
    key = (
        "coalesce(-(SELECT min((%s::jsonb ->> z)::int) FROM unnest(jobs.timezones) AS z),"
        f" {_UNKNOWN_ZONE})"
    )
    return SortPlan(TIMEZONE, key, [json.dumps(zone_gaps(user_offset, at))])


def decode_cursor(plan: SortPlan, cursor: str) -> tuple[int | None, datetime, int]:
    """(key, t, id) of a cursor issued for `plan` (key None for newest), or 400 invalid_cursor."""
    try:
        if plan.key_sql is None:
            t, i = decode_feed_cursor(cursor)
            return None, t, i
        s, k, t, i = decode_sort_cursor(cursor)
        if s != plan.name:
            raise InvalidCursor("cursor is for another sort")
        return k, t, i
    except InvalidCursor as exc:
        raise _bad_request("invalid_cursor", "Invalid cursor") from exc


def fetch_page(
    conn: psycopg.Connection,
    plan: SortPlan,
    cursor: str | None,
    *,
    columns: str,
    from_sql: str,
    from_params: list[Any],
    clauses: list[str],
    where_params: list[Any],
    limit: int,
) -> tuple[list[tuple], str | None]:
    """One page of `SELECT {columns} FROM {from_sql} WHERE {clauses}` in `plan`'s order, plus the
    next cursor (None on the last page). `columns` must start with `JOB_COLUMNS` (the cursor reads
    the job's id / dates from it); `from_params` are `from_sql`'s own params (a JOIN's)."""
    position = decode_cursor(plan, cursor) if cursor else None
    clauses = list(clauses)
    params: list[Any] = [*from_params, *where_params]

    if plan.key_sql is None:
        if position:
            clauses.append(f"({TIME_SQL}, jobs.id) < (%s, %s)")
            params.extend(position[1:])
        where = " AND ".join(clauses) or "TRUE"
        sql = (
            f"SELECT {columns} FROM {from_sql} WHERE {where}"
            f" ORDER BY {TIME_SQL} DESC, jobs.id DESC LIMIT %s"
        )
        params = [*params, limit + 1]
    else:
        where = " AND ".join(clauses) or "TRUE"
        inner_cols = f"{plan.key_sql} AS sort_key, {TIME_SQL} AS sort_t, {columns}"
        inner = f"SELECT {inner_cols} FROM {from_sql} WHERE {where}"
        page_where = " WHERE (sort_key, sort_t, id) < (%s, %s, %s)" if position else ""
        outer_cols = ", ".join(c.strip().split(".")[-1] for c in columns.split(","))
        sql = (
            f"SELECT {outer_cols}, sort_key FROM ({inner}) AS page{page_where}"
            " ORDER BY sort_key DESC, sort_t DESC, id DESC LIMIT %s"
        )
        params = [*plan.key_params, *params, *(position or ()), limit + 1]

    rows = conn.execute(sql, params).fetchall()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = None
    if plan.key_sql is None:
        if has_more and page:
            next_cursor = encode_feed_cursor(*job_sort_key(page[-1]))
        return page, next_cursor
    if has_more and page:
        t, i = job_sort_key(page[-1][:-1])
        next_cursor = encode_sort_cursor(plan.name, page[-1][-1], t, i)
    return [row[:-1] for row in page], next_cursor
