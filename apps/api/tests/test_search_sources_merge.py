"""`merge_live_search` with monkeypatched source adapters: no real network/API calls."""

import asyncio

import pytest
from job_crawler.models import JobRecord

from ujc_api.search_sources import merge_live_search


def _job(source: str, external_id: str, title: str = "Engineer") -> JobRecord:
    return JobRecord(
        source=source, external_id=external_id, url=f"https://x/{external_id}", title=title,
        company="Acme",
    )  # fmt: skip


@pytest.mark.asyncio
async def test_merges_and_dedupes_by_source_and_external_id():
    fetchers = {
        "remotive": lambda q, limit: asyncio.sleep(0, result=[_job("remotive", "1")]),
        "wwr": lambda q, limit: asyncio.sleep(0, result=[_job("weworkremotely", "2")]),
    }
    jobs, next_state, statuses = await merge_live_search(
        "python", ["remotive", "wwr"], {}, fetchers=fetchers
    )
    assert {(j.source, j.external_id) for j in jobs} == {("remotive", "1"), ("weworkremotely", "2")}
    assert next_state == {"remotive": None, "wwr": None}
    ids = {s["id"] for s in statuses}
    assert ids == {"remotive", "wwr"}
    assert all(s["count"] == 1 for s in statuses)


@pytest.mark.asyncio
async def test_duplicate_external_id_across_calls_collapses_to_one():
    fetchers = {
        "remotive": lambda q, limit: asyncio.sleep(0, result=[_job("remotive", "1", "A")]),
    }
    jobs, _, _ = await merge_live_search("python", ["remotive"], {}, fetchers=fetchers)
    assert len(jobs) == 1


@pytest.mark.asyncio
async def test_failing_source_is_reported_without_failing_the_request():
    async def boom(q, limit):
        raise RuntimeError("source is down")

    fetchers = {
        "remotive": lambda q, limit: asyncio.sleep(0, result=[_job("remotive", "1")]),
        "arc": boom,
    }
    jobs, next_state, statuses = await merge_live_search(
        "python", ["remotive", "arc"], {}, fetchers=fetchers
    )
    assert [j.source for j in jobs] == ["remotive"]
    by_id = {s["id"]: s for s in statuses}
    assert by_id["arc"]["count"] == 0
    assert "source is down" in by_id["arc"]["error"]
    assert by_id["remotive"]["count"] == 1
    # a failed source keeps its previous page so the client can retry it
    assert next_state["arc"] == 1


@pytest.mark.asyncio
async def test_paged_source_advances_page_until_short_page_marks_exhausted():
    async def fetch(q, page, limit):
        pages = {1: [_job("seek", "a"), _job("seek", "b")], 2: [_job("seek", "c")]}
        return pages.get(page, [])

    fetchers = {"seek": fetch}

    jobs1, state1, _ = await merge_live_search("x", ["seek"], {}, limit=2, fetchers=fetchers)
    assert len(jobs1) == 2
    assert state1["seek"] == 2  # full page -> not exhausted yet

    jobs2, state2, _ = await merge_live_search("x", ["seek"], state1, limit=2, fetchers=fetchers)
    assert len(jobs2) == 1
    assert state2["seek"] is None  # short page -> exhausted


@pytest.mark.asyncio
async def test_exhausted_source_is_skipped_without_calling_its_fetcher():
    calls = []

    async def fetch(q, limit):
        calls.append(1)
        return []

    fetchers = {"remotive": fetch}
    jobs, next_state, statuses = await merge_live_search(
        "x", ["remotive"], {"remotive": None}, fetchers=fetchers
    )
    assert jobs == []
    assert statuses == []
    assert calls == []
    assert next_state["remotive"] is None


@pytest.mark.asyncio
async def test_unknown_source_ids_are_ignored():
    jobs, next_state, statuses = await merge_live_search(
        "x", ["not-a-real-source"], {}, fetchers={}
    )
    assert jobs == []
    assert statuses == []
    assert next_state == {}


@pytest.mark.asyncio
async def test_upwork_is_never_included_even_if_a_fetcher_returns_it():
    async def fetch(q, limit):
        return [_job("upwork", "1"), _job("remotive", "2")]

    fetchers = {"remotive": fetch}
    jobs, _, _ = await merge_live_search("x", ["remotive"], {}, fetchers=fetchers)
    assert [j.source for j in jobs] == ["remotive"]
