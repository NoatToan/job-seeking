"""Live search: one page from each of seek/himalayas/remotive/wwr/arc, normalised to
`JobRecord`, merged in parallel with per-source timeouts and errors
(docs/product/FLOW_V2.md §3 "Cursor (live search)").

- seek, himalayas, remotive: `job_crawler.sources` (shared with the crawler's per-profile search;
  see docs/product/ARCHITECTURE.md D11). seek and himalayas take an explicit page; both run off
  the event loop since they use the blocking `HttpClient`.
- wwr, arc: `job_search_mcp.sources` (async httpx); these two have no `job_crawler` equivalent yet.

Upwork is never a source here (see docs/product/FLOW_V2.md §1): the registry below only ever
names the five sources in the contract, and `merge_live_search` drops anything else defensively.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from email.utils import parsedate_to_datetime

from job_crawler.http import HttpClient
from job_crawler.models import JobRecord
from job_crawler.profile_search import HIMALAYAS_SEARCH_URL
from job_crawler.sources import himalayas as crawler_himalayas
from job_crawler.sources import remotive as crawler_remotive
from job_crawler.sources import seek as crawler_seek
from job_crawler.text import clean, parse_datetime
from job_search_mcp.sources import arc as mcp_arc
from job_search_mcp.sources import wwr as mcp_wwr

from ujc_api.cursor import SEARCH_SOURCE_IDS

log = logging.getLogger(__name__)

SOURCE_TIMEOUT_S = 8.0
#: Sources that support an explicit page param; the rest are fetched once and marked exhausted.
PAGED_SOURCES = frozenset({"seek", "himalayas"})
_NEVER_A_SOURCE = {"upwork"}


def _external_id_from_url(url: str) -> str:
    return url.rstrip("/").rsplit("/", 1)[-1] or url


def _best_effort_datetime(value: object):
    """ISO-8601/epoch (`parse_datetime`) or RFC-822 (WWR's RSS `pubDate`)."""
    dt = parse_datetime(value)
    if dt is not None or not isinstance(value, str) or not value:
        return dt
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None


def wwr_to_job_record(d: dict) -> JobRecord:
    url = d.get("url") or ""
    tags = [t for t in [clean(d.get("category"))] if t]
    return JobRecord(
        source="weworkremotely",
        external_id=_external_id_from_url(url),
        url=url,
        apply_url=url,
        title=clean(d.get("title")) or "Untitled",
        company=clean(d.get("company")) or "Unknown",
        location=clean(d.get("location")) or "Worldwide",
        remote=True,
        employment_type=clean(d.get("work_type")),
        salary_text=None,
        description=clean(d.get("summary")),
        tags=tags,
        posted_at=_best_effort_datetime(d.get("posted_at")),
        raw=d,
    )


def arc_to_job_record(d: dict) -> JobRecord:
    url = d.get("url") or ""
    return JobRecord(
        source="arc",
        external_id=_external_id_from_url(url),
        url=url,
        apply_url=url,
        title=clean(d.get("title")) or "Untitled",
        company=clean(d.get("company")) or "Unknown",
        location=clean(d.get("location")) or "Worldwide",
        remote=True,
        employment_type=clean(d.get("work_type")),
        salary_text=clean(d.get("salary")),
        description=None,
        tags=list(d.get("skills") or []),
        posted_at=_best_effort_datetime(d.get("posted_at")),
        raw=d,
    )


def _seek_page_sync(q: str, page: int, limit: int) -> list[JobRecord]:
    with HttpClient() as http:
        return crawler_seek.search(http, q, limit=limit, page=page)


async def fetch_seek(q: str, page: int, limit: int) -> list[JobRecord]:
    return await asyncio.to_thread(_seek_page_sync, q, page, limit)


def _himalayas_page_sync(q: str, page: int) -> list[JobRecord]:
    with HttpClient() as http:
        payload = http.get_json(HIMALAYAS_SEARCH_URL, params={"q": q, "page": page})
    return crawler_himalayas.parse(payload)


async def fetch_himalayas(q: str, page: int, limit: int) -> list[JobRecord]:
    records = await asyncio.to_thread(_himalayas_page_sync, q, page)
    return records[:limit]


def _remotive_sync(q: str, limit: int) -> list[JobRecord]:
    with HttpClient() as http:
        return crawler_remotive.search(http, q, limit=limit)


async def fetch_remotive(q: str, limit: int) -> list[JobRecord]:
    return await asyncio.to_thread(_remotive_sync, q, limit)


async def fetch_wwr(q: str, limit: int) -> list[JobRecord]:
    dicts = await mcp_wwr.search(keywords=q or None, limit=limit)
    return [wwr_to_job_record(d) for d in dicts]


async def fetch_arc(q: str, limit: int) -> list[JobRecord]:
    dicts = await mcp_arc.search(keywords=q or None, limit=limit)
    return [arc_to_job_record(d) for d in dicts]


#: id -> adapter. Paged sources take `(q, page, limit)`; single-page sources take `(q, limit)`.
#: A module-level dict (rather than a hardcoded call per source) so tests can monkeypatch one
#: entry (e.g. to simulate a failing source) without touching the others.
FETCHERS: dict[str, Callable[..., Awaitable[list[JobRecord]]]] = {
    "seek": fetch_seek,
    "himalayas": fetch_himalayas,
    "remotive": fetch_remotive,
    "wwr": fetch_wwr,
    "arc": fetch_arc,
}


async def merge_live_search(
    q: str,
    requested: list[str],
    cursor_state: dict[str, int | None],
    *,
    limit: int = 20,
    fetchers: dict[str, Callable[..., Awaitable[list[JobRecord]]]] | None = None,
) -> tuple[list[JobRecord], dict[str, int | None], list[dict]]:
    """Fetches the next page of every requested, non-exhausted source in parallel.

    Returns `(jobs, next_state, source_statuses)`. `jobs` is de-duplicated by `(source,
    external_id)`; `next_state` is the full per-source cursor state to encode for the next call;
    `source_statuses` is `[{id, count, error?}]`, one entry per source actually attempted.
    """
    fetchers = fetchers if fetchers is not None else FETCHERS
    requested = [s for s in requested if s in SEARCH_SOURCE_IDS]

    jobs_by_key: dict[tuple[str, str], JobRecord] = {}
    statuses: list[dict] = []
    next_state: dict[str, int | None] = dict(cursor_state)

    async def run_one(source_id: str) -> None:
        page = cursor_state.get(source_id, 1)
        if page is None:
            next_state[source_id] = None
            return
        fetch = fetchers.get(source_id)
        if fetch is None:
            return
        try:
            if source_id in PAGED_SOURCES:
                records = await asyncio.wait_for(fetch(q, page, limit), timeout=SOURCE_TIMEOUT_S)
                next_state[source_id] = None if len(records) < limit else page + 1
            else:
                records = await asyncio.wait_for(fetch(q, limit), timeout=SOURCE_TIMEOUT_S)
                next_state[source_id] = None  # single-page sources: exhausted after one fetch
        except Exception as exc:  # noqa: BLE001 - one source failing must not fail the request
            log.warning("live search source %s failed: %s", source_id, exc)
            next_state[source_id] = page  # unchanged: let the client retry this source
            statuses.append({"id": source_id, "count": 0, "error": str(exc) or type(exc).__name__})
            return
        statuses.append({"id": source_id, "count": len(records)})
        for record in records:
            if record.source in _NEVER_A_SOURCE:
                continue
            jobs_by_key[(record.source, record.external_id)] = record

    await asyncio.gather(*(run_one(source_id) for source_id in requested))

    return list(jobs_by_key.values()), next_state, statuses
