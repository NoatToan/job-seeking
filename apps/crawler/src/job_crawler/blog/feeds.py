"""Parse publisher RSS/Atom feeds into attribution-ready article records.

Copyright model (docs/DECISIONS.md "Blog"):
- every article: metadata plus an excerpt of at most EXCERPT_MAX_WORDS words, as plain text,
  taken from the feed's own summary (or the start of its body when it has no summary);
- `full` sources only (licence verified in sources.py): also the feed's full text, converted to a
  sanitised block document (body.py). An item whose own <rights> doesn't match the source's
  expected licence, or whose body can't be converted, falls back to excerpt mode.
"""

import calendar
import hashlib
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import feedparser
import httpx
from pydantic import BaseModel, Field

from job_crawler import USER_AGENT
from job_crawler.blog.body import body_text, html_to_blocks
from job_crawler.blog.sources import FeedSource, RepublishMode
from job_crawler.blog.topics import classify
from job_crawler.http import HttpClient
from job_crawler.text import html_to_text

log = logging.getLogger(__name__)

EXCERPT_MAX_WORDS = 50
TITLE_MAX_CHARS = 300
AUTHOR_MAX_CHARS = 120

_TRACKING_PARAMS = re.compile(r"^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|source)$")
# WordPress appends "The post <title> appeared first on <site>." to every summary.
_WP_BOILERPLATE = re.compile(r"\s*The post .{1,400}? appeared first on .{1,200}?\.\s*$", re.S)
# Section labels some feeds start every summary with ("Dive Brief: - ...").
_LEADING_LABEL = re.compile(r"^(dive brief|key points|summary|tl;dr)\s*:\s*(- )?", re.I)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class Article(BaseModel):
    """One referenced third-party article (row of `blog_articles`)."""

    source: str
    source_name: str  # publisher name for the credit line
    source_url: str | None = None  # publisher homepage
    external_id: str
    url: str
    title: str
    author: str | None = None
    excerpt: str | None = None
    published_at: datetime | None = None
    topics: list[str] = Field(default_factory=list)
    republish_mode: RepublishMode = "excerpt"
    # Full mode only: our page /blog/articles/<slug>/, the licence, the sanitised body, and the
    # tracking pixel the licence requires (if any).
    slug: str | None = None
    licence_name: str | None = None
    licence_url: str | None = None
    body: list[dict[str, Any]] | None = None
    pixel_url: str | None = None


def plain(value: str | None) -> str | None:
    """Feed HTML -> one line of plain text (tags, scripts and control characters dropped)."""
    text = html_to_text(value)
    if not text:
        return None
    text = _CONTROL.sub("", re.sub(r"\s+", " ", text)).strip()
    return text or None


def excerpt(value: str | None, max_words: int = EXCERPT_MAX_WORDS) -> str | None:
    """Plain-text excerpt of at most `max_words` words, with an ellipsis when cut."""
    text = plain(value)
    if not text:
        return None
    text = _LEADING_LABEL.sub("", _WP_BOILERPLATE.sub("", text).strip())
    words = text.split()
    if not words:
        return None
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(",;:—–-") + "…"


def normalize_url(url: str) -> str:
    """Canonical form used for dedupe: https/http only, lower-case host, no fragment, no tracking
    parameters (utm_*, fbclid…), no trailing slash differences on the path root."""
    parts = urlsplit(url.strip())
    query = urlencode(
        [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not _TRACKING_PARAMS.match(k)
        ]
    )
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", query, ""))


def allowed_url(url: str, hosts: tuple[str, ...]) -> bool:
    """True for an http(s) URL on one of `hosts` (or a subdomain of one)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password:
        return False
    return any(host == h or host.endswith("." + h) for h in hosts)


def _published(entry: Any) -> datetime | None:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    return datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC) if parsed else None


def _content_html(entry: Any) -> str | None:
    content = entry.get("content") or []
    return content[0].get("value") if content else None


def _summary_html(entry: Any) -> str | None:
    """The item's own summary; the body (`content`) only when there is no summary at all."""
    return entry.get("summary") or _content_html(entry)


def slugify(title: str, url: str) -> str:
    """URL slug for a republished article: words of the title + a short hash of its URL."""
    words = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:70].rstrip("-") or "article"
    return f"{words}-{hashlib.sha1(url.encode()).hexdigest()[:6]}"


def _full_text(entry: Any, source: FeedSource, url: str) -> dict[str, Any] | None:
    """Full-mode fields for one item, or None to keep it excerpt-only."""
    if source.republish_mode != "full":
        return None
    if source.item_rights_pattern:
        rights = str(entry.get("rights") or "")
        if not re.search(source.item_rights_pattern, rights, re.IGNORECASE):
            log.info("%s: %s has rights %r, excerpt only", source.key, url, rights[:80])
            return None
    try:
        blocks, pixel = html_to_blocks(
            _content_html(entry) or entry.get("summary"), url, pixel_pattern=source.pixel_pattern
        )
    except ValueError as exc:
        log.info("%s: %s body unusable (%s), excerpt only", source.key, url, exc)
        return None
    if source.pixel_pattern and not pixel:
        log.info("%s: %s has no required counter pixel, excerpt only", source.key, url)
        return None
    return {
        "republish_mode": "full",
        "licence_name": source.licence_name,
        "licence_url": source.licence_url,
        "body": blocks,
        "pixel_url": pixel,
    }


def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def parse(feed_text: str, source: FeedSource, *, now: datetime | None = None) -> list[Article]:
    """Feed XML -> articles, newest first, at most `max_items_per_run`. Drops items without a
    usable title/link, links off the source's hosts, items older than `max_age_days`, and (for
    sources with `require_topics`) off-topic items."""
    now = now or datetime.now(UTC)
    feed = feedparser.parse(feed_text)
    out: list[Article] = []
    seen: set[str] = set()
    for entry in feed.entries:
        link = entry.get("link") or ""
        title = _clip(plain(entry.get("title")), TITLE_MAX_CHARS)
        if not link or not title or not allowed_url(link, source.hosts):
            continue
        url = normalize_url(link)
        if url in seen:
            continue
        published = _published(entry)
        if published and now - published > timedelta(days=source.max_age_days):
            continue
        text = excerpt(_summary_html(entry))
        topics = classify(f"{title}. {text or ''}")
        # Broad feeds must be on-topic by their headline, not by a passing word in the summary.
        if source.require_topics and not set(classify(title)) & set(source.require_topics):
            continue
        topics = topics or list(source.default_topics)
        full = _full_text(entry, source, url)
        if full and not text:
            text = excerpt(body_text(full["body"]))
        seen.add(url)
        out.append(
            Article(
                source=source.key,
                source_name=source.name,
                source_url=source.homepage,
                external_id=_clip(str(entry.get("id") or url), 500) or url,
                url=url,
                title=title,
                author=_clip(plain(entry.get("author")), AUTHOR_MAX_CHARS),
                excerpt=text,
                published_at=published,
                topics=topics,
                slug=slugify(title, url) if full else None,
                **(full or {}),
            )
        )
    out.sort(key=lambda a: a.published_at or now, reverse=True)
    return out[: source.max_items_per_run]


class Robots:
    """robots.txt cache per host. A missing robots.txt (404/410) allows everything; any other
    failure (403, 5xx, network) disallows, so we stay conservative."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http
        self._cache: dict[str, RobotFileParser | None] = {}

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._cache:
            self._cache[origin] = self._load(origin)
        parser = self._cache[origin]
        return parser is not None and parser.can_fetch(USER_AGENT, url)

    def _load(self, origin: str) -> RobotFileParser | None:
        parser = RobotFileParser()
        try:
            response = self._http.get(f"{origin}/robots.txt")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (404, 410):
                parser.parse([])
                return parser
            log.warning(
                "robots.txt %s -> %s: treating as disallowed", origin, exc.response.status_code
            )
            return None
        except httpx.HTTPError as exc:
            log.warning("robots.txt %s failed (%s): treating as disallowed", origin, exc)
            return None
        parser.parse(response.text.splitlines())
        return parser


class FeedResult(BaseModel):
    source: str
    articles: list[Article] = Field(default_factory=list)
    error: str | None = None


def fetch(http: HttpClient, robots: Robots, source: FeedSource) -> FeedResult:
    """Fetch and parse one feed, after checking robots.txt. Never raises."""
    if not robots.allowed(source.feed_url):
        return FeedResult(source=source.key, error="disallowed by robots.txt")
    try:
        response = http.get(source.feed_url)
        return FeedResult(source=source.key, articles=parse(response.text, source))
    except Exception as exc:  # noqa: BLE001 - one bad feed must not stop the others
        return FeedResult(source=source.key, error=f"{type(exc).__name__}: {exc}")
