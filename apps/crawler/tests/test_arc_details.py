"""Arc descriptions: the job page parser, the runner's job-page pass, and the upsert keeping a
description the listing doesn't carry."""

import os
from pathlib import Path

import psycopg
import pytest

from job_crawler import db
from job_crawler.models import JobRecord
from job_crawler.session import __main__ as session_main
from job_crawler.session.sites import SITES, parse_arc_detail

FIXTURES = Path(__file__).parent / "fixtures"
ARC = SITES["arc"]


def test_parse_arc_detail_live_page():
    description = parse_arc_detail((FIXTURES / "arc_detail.html").read_text())
    assert description.startswith("### Role Overview")
    assert "React Native" in description


@pytest.mark.parametrize(
    "html",
    [
        "<html>no data</html>",
        '<script id="__NEXT_DATA__">{"props": {"pageProps": {}}}</script>',
        '<script id="__NEXT_DATA__">{"props": {"pageProps": {"job": {"description": " "}}}}'
        "</script>",
        '<script id="__NEXT_DATA__">not json</script>',
    ],
)
def test_parse_arc_detail_without_description(html):
    assert parse_arc_detail(html) is None


def job(key: str) -> JobRecord:
    return JobRecord(
        source="arc",
        external_id=key,
        url=f"https://arc.dev/remote-jobs/details/x-{key}",
        title="Dev",
        company="Acme",
    )


class FakePage:
    def __init__(self, pages: dict[str, str]):
        self.pages, self.opened, self.url = pages, [], ""

    def goto(self, url, **_):
        self.opened.append(url)
        self.url = url
        if url not in self.pages:
            raise TimeoutError("navigation timeout")

    def wait_for_timeout(self, _ms):
        pass

    def title(self):
        return "Job - Arc"

    def content(self):
        return self.pages[self.url]


def detail_html(text: str) -> str:
    return (
        '<script id="__NEXT_DATA__">{"props": {"pageProps": {"job": {"description": "'
        + text
        + '"}}}}</script>'
    )


def test_fetch_details_fills_skips_and_caps(monkeypatch):
    monkeypatch.setattr(session_main.time, "sleep", lambda _s: None)
    jobs = [job(k) for k in ("a", "b", "c", "d", "e")]
    jobs[1].description = "already from the listing"
    page = FakePage(
        {j.url: detail_html(f"About {j.external_id}") for j in jobs if j.external_id != "d"}
    )
    site = ARC.__class__(**{**ARC.__dict__, "max_details": 3})

    filled = session_main.fetch_details(site, page, [*jobs, jobs[0]], skip={"c"})

    # b has one, c is already described in the database, a is listed twice: a, d (fails), e.
    assert [u.rsplit("-", 1)[1] for u in page.opened] == ["a", "d", "e"]
    assert filled == 2
    assert [j.description for j in jobs] == [
        "About a",
        "already from the listing",
        None,
        None,
        "About e",
    ]


def test_fetch_details_is_a_no_op_for_sites_with_descriptions():
    page = FakePage({})
    assert session_main.fetch_details(SITES["linkedin"], page, [job("a")]) == 0
    assert page.opened == []


@pytest.fixture
def conn():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(url) as connection, connection.transaction(force_rollback=True):
        yield connection


def test_listing_upsert_keeps_the_job_page_description(conn):
    described = job("keep1")
    described.description = "### Role Overview\nBuild the app."
    db.upsert_jobs(conn, [described])
    db.upsert_jobs(conn, [job("keep1")])  # next day's listing: no description
    row = conn.execute(
        "SELECT description, sections IS NOT NULL FROM jobs WHERE source = 'arc'"
        " AND external_id = 'keep1'"
    ).fetchone()
    assert row[0].startswith("### Role Overview")
    assert db.described_ids(conn, "arc") >= {"keep1"}


def test_listing_upsert_keeps_derived_columns_from_the_stored_description(conn):
    described = job("keep2")
    described.description = (
        "### Responsibilities\n- Build the app with React Native.\n\nRelocation package provided."
    )
    db.upsert_jobs(conn, [described])
    db.upsert_jobs(conn, [job("keep2")])
    sections, tech, support = conn.execute(
        "SELECT sections, tech_stack, relocation_support FROM jobs"
        " WHERE source = 'arc' AND external_id = 'keep2'"
    ).fetchone()
    assert sections and "react-native" in tech and support is True
