"""Blog feed parsing: excerpts, dedupe, link safety, licence gating, robots.txt. No network."""

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from job_crawler.blog.feeds import (
    EXCERPT_MAX_WORDS,
    Robots,
    allowed_url,
    excerpt,
    fetch,
    normalize_url,
    parse,
    slugify,
)
from job_crawler.blog.sources import SOURCES_BY_KEY, FeedSource
from job_crawler.http import HttpClient

FIXTURES = Path(__file__).parent / "fixtures" / "blog"
NOW = datetime(2026, 11, 6, 12, 0, tzinfo=UTC)

EXCERPT_SOURCE = FeedSource(
    key="example-research",
    name="Example Hiring Research",
    homepage="https://research.example.com/",
    feed_url="https://research.example.com/feed/",
    hosts=("research.example.com",),
    default_topics=("labour-market",),
)
CONVERSATION = SOURCES_BY_KEY["conversation-labour-market"]
BLS = SOURCES_BY_KEY["bls-jolts"]


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --- excerpts and text --------------------------------------------------------------------------


def test_excerpt_is_capped_at_50_words_with_ellipsis():
    text = " ".join(f"w{i}" for i in range(80))
    out = excerpt(f"<p>{text}</p>")
    assert out is not None
    assert len(out.split()) == EXCERPT_MAX_WORDS
    assert out.endswith("…")


def test_excerpt_strips_html_scripts_and_wordpress_boilerplate():
    html = (
        "<p>Short <b>summary</b>.</p><script>alert(1)</script>"
        '<p>The post <a href="x">Title</a> appeared first on <a href="y">Site</a>.</p>'
    )
    assert excerpt(html) == "Short summary."


def test_excerpt_strips_leading_section_label():
    assert excerpt("Dive Brief: - Employers expect layoffs.") == "Employers expect layoffs."


def test_excerpt_empty():
    assert excerpt(None) is None
    assert excerpt("<p>  </p>") is None


# --- urls -----------------------------------------------------------------------------------------


def test_normalize_url_drops_tracking_and_fragment():
    assert (
        normalize_url("HTTPS://Example.com/a/?utm_source=rss&id=3&fbclid=x#comments")
        == "https://example.com/a/?id=3"
    )


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://research.example.com/x", True),
        ("http://sub.research.example.com/x", True),
        ("https://research.example.com.evil.net/x", False),
        ("https://evil.example.net/x", False),
        ("javascript:alert(1)", False),
        ("https://user:pw@research.example.com/x", False),
        ("ftp://research.example.com/x", False),
    ],
)
def test_allowed_url(url, ok):
    assert allowed_url(url, ("research.example.com",)) is ok


def test_slugify():
    slug = slugify("Unemployment hits 4.7% — what's next?", "https://x.test/a")
    assert slug.startswith("unemployment-hits-4-7-what-s-next-")
    assert len(slug.rsplit("-", 1)[1]) == 6


# --- excerpt-mode parsing ------------------------------------------------------------------------


def test_parse_excerpt_mode_keeps_metadata_and_short_excerpt_only():
    articles = parse(fixture("wordpress_excerpt.xml"), EXCERPT_SOURCE, now=NOW)
    assert [a.title for a in articles] == [
        "Hiring demand cools as job postings slip in October",
        "Dive Brief style summary that is very long",
    ]
    first = articles[0]
    assert first.url == "https://research.example.com/2026/11/05/hiring-demand-cools/"
    assert first.author == "Ada Analyst"
    assert first.source_name == "Example Hiring Research"
    assert first.published_at == datetime(2026, 11, 5, 15, 38, 57, tzinfo=UTC)
    assert (
        first.excerpt
        == "Job postings fell for a third month as employers grew cautious about hiring."
    )
    assert first.topics[0] == "hiring"
    # Copyright model: never the body, never a page, never a licence in excerpt mode.
    assert first.republish_mode == "excerpt"
    assert first.body is None and first.slug is None and first.licence_url is None
    assert "FULL BODY" not in first.model_dump_json()
    long = articles[1]
    assert len(long.excerpt.split()) == EXCERPT_MAX_WORDS
    assert not long.excerpt.lower().startswith("dive brief")


def test_parse_respects_max_items_and_require_topics():
    capped = replace(EXCERPT_SOURCE, max_items_per_run=1)
    assert len(parse(fixture("wordpress_excerpt.xml"), capped, now=NOW)) == 1
    strict = replace(EXCERPT_SOURCE, require_topics=("remote-work",))
    assert parse(fixture("wordpress_excerpt.xml"), strict, now=NOW) == []


def test_full_mode_source_without_licence_is_rejected():
    with pytest.raises(ValueError):
        replace(EXCERPT_SOURCE, republish_mode="full")


# --- full-mode parsing ---------------------------------------------------------------------------


def test_parse_full_mode_republishes_cc_items_with_sanitised_body():
    articles = {a.url: a for a in parse(fixture("conversation.atom"), CONVERSATION, now=NOW)}
    a = articles["https://theconversation.com/unemployment-rises-in-a-cooling-labour-market-1001"]
    assert a.republish_mode == "full"
    assert a.licence_name == "CC BY-ND 4.0"
    assert a.licence_url == "https://creativecommons.org/licenses/by-nd/4.0/"
    assert a.author == "Jane Economist, Professor of Economics, Example University"
    assert a.source_name == "The Conversation"
    assert a.pixel_url == "https://counter.theconversation.com/content/1001/count.gif"
    assert a.slug and a.slug.startswith("unemployment-rises-in-a-cooling-labour-market-")
    body = a.model_dump_json()
    for banned in ("steal()", "iframe", "evil.example.net", "javascript:", "chart.png", "caption"):
        assert banned not in body
    assert a.body[0] == {
        "type": "p",
        "inline": [
            {"text": "Unemployment rose to "},
            {"text": "4.7%", "bold": True},
            {"text": ", "},
            {"text": "official data", "href": "https://www.abs.gov.au/stats"},
            {"text": " show."},
        ],
    }
    assert {"type": "h", "level": 2, "inline": [{"text": "What next"}]} in a.body
    assert {"text": "relative", "href": "https://theconversation.com/relative-path"} in a.body[-1][
        "inline"
    ]


def test_parse_full_mode_falls_back_to_excerpt_on_other_rights_or_missing_pixel():
    articles = {a.url: a for a in parse(fixture("conversation.atom"), CONVERSATION, now=NOW)}
    other = articles["https://theconversation.com/a-differently-licensed-article-1002"]
    no_pixel = articles["https://theconversation.com/no-counter-pixel-1003"]
    for a in (other, no_pixel):
        assert a.republish_mode == "excerpt"
        assert a.body is None and a.slug is None and a.pixel_url is None
    assert "must not be republished" not in other.model_dump_json()


def test_parse_bls_atom_content_only():
    [a] = parse(fixture("bls.atom"), BLS, now=NOW)
    assert a.republish_mode == "full"
    assert a.licence_name == "Public domain (U.S. government work)"
    assert a.excerpt.startswith("The number of job openings was little changed")
    assert a.body == [
        {
            "type": "p",
            "inline": [
                {
                    "text": "The number of job openings was little changed at 7.5 million in"
                    " September. Quits increased to 3.4 million."
                }
            ],
        }
    ]
    assert set(a.topics) & {"labour-market", "hiring"}


# --- robots.txt and fetch ------------------------------------------------------------------------


def _client(routes: dict[str, httpx.Response], seen: list[str]) -> HttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return routes.get(str(request.url), httpx.Response(404))

    return HttpClient(transport=httpx.MockTransport(handler), retries=0, board_delay=0)


def test_robots_missing_allows_and_forbidden_disallows():
    seen: list[str] = []
    routes = {"https://a.test/robots.txt": httpx.Response(403)}
    with _client(routes, seen) as http:
        robots = Robots(http)
        assert robots.allowed("https://b.test/feed") is True  # 404 -> allow
        assert robots.allowed("https://a.test/feed") is False  # 403 -> disallow
        assert robots.allowed("https://a.test/other") is False
    assert seen.count("https://a.test/robots.txt") == 1  # cached per host


def test_fetch_skips_feed_disallowed_by_robots():
    seen: list[str] = []
    routes = {
        "https://research.example.com/robots.txt": httpx.Response(
            200, text="User-agent: *\nDisallow: /feed/\n"
        )
    }
    with _client(routes, seen) as http:
        result = fetch(http, Robots(http), EXCERPT_SOURCE)
    assert result.error == "disallowed by robots.txt"
    assert "https://research.example.com/feed/" not in seen


def test_fetch_parses_allowed_feed_and_reports_errors():
    seen: list[str] = []
    routes = {
        "https://research.example.com/robots.txt": httpx.Response(200, text="User-agent: *\n"),
        "https://research.example.com/feed/": httpx.Response(
            200, text=fixture("wordpress_excerpt.xml")
        ),
    }
    with _client(routes, seen) as http:
        result = fetch(http, Robots(http), EXCERPT_SOURCE)
        broken = fetch(
            http, Robots(http), replace(EXCERPT_SOURCE, feed_url="https://research.example.com/x")
        )
    assert result.error is None and result.articles
    assert broken.error and "404" in broken.error


def test_excerpt_is_capped_in_characters_too():
    out = excerpt("x" * 5000)
    assert out is not None and len(out) <= 600 and out.endswith("…")


def test_parse_puts_undated_items_last():
    feed = """<rss version="2.0"><channel>
      <item><title>Undated hiring note</title><link>https://research.example.com/u</link></item>
      <item><title>Dated hiring news</title><link>https://research.example.com/d</link>
        <pubDate>Thu, 05 Nov 2026 15:38:57 +0000</pubDate></item>
    </channel></rss>"""
    assert [a.title for a in parse(feed, EXCERPT_SOURCE, now=NOW)] == [
        "Dated hiring news",
        "Undated hiring note",
    ]


def test_fetch_rejects_oversized_feed(monkeypatch):
    monkeypatch.setattr("job_crawler.blog.feeds.FEED_MAX_BYTES", 1000)
    seen: list[str] = []
    routes = {
        "https://research.example.com/robots.txt": httpx.Response(200, text="User-agent: *\n"),
        "https://research.example.com/feed/": httpx.Response(200, text="x" * 5000),
    }
    with _client(routes, seen) as http:
        result = fetch(http, Robots(http), EXCERPT_SOURCE)
    assert result.error and "ResponseTooLarge" in result.error


def test_capped_get_handles_gzip_bodies():
    import gzip

    body = gzip.compress(b"User-agent: *\nDisallow: /private/\n")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"Content-Encoding": "gzip"})

    with HttpClient(transport=httpx.MockTransport(handler), retries=0, board_delay=0) as http:
        response = http.get("https://a.test/robots.txt", max_bytes=1000)
        assert "Disallow: /private/" in response.text
        assert Robots(http).allowed("https://a.test/feed") is True
        assert Robots(http).allowed("https://a.test/private/x") is False
