import calendar
import logging
from datetime import UTC, datetime
from typing import Any

import feedparser

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult
from job_crawler.text import clean, html_to_text

log = logging.getLogger(__name__)

SOURCE = "weworkremotely"
FEED_URL = "https://weworkremotely.com/categories/{category}.rss"
CATEGORIES = [
    "remote-programming-jobs",
    "remote-full-stack-programming-jobs",
    "remote-back-end-programming-jobs",
    "remote-front-end-programming-jobs",
    "remote-devops-sysadmin-jobs",
    "remote-design-jobs",
]
_RAW_KEYS = (
    "id", "title", "link", "published", "region", "country", "state", "skills", "type",
    "expires_at",
)


def _split_title(title: str) -> tuple[str, str]:
    """WWR item titles are usually 'Company: Job title'."""
    company, sep, job_title = title.partition(": ")
    if sep and company.strip() and job_title.strip():
        return company.strip(), job_title.strip()
    return "Unknown", title.strip()


def _posted_at(entry: Any) -> datetime | None:
    parsed = entry.get("published_parsed")
    return datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC) if parsed else None


def parse(feed_text: str) -> list[JobRecord]:
    feed = feedparser.parse(feed_text)
    jobs = []
    for entry in feed.entries:
        url = entry.get("link") or entry.get("id")
        title = clean(entry.get("title"))
        if not url or not title:
            continue
        company, job_title = _split_title(title)
        tags = [clean(t.get("term")) for t in entry.get("tags") or []]
        tags += [s.strip() for s in (entry.get("skills") or "").split(" and ")]
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=entry.get("id") or url,
                url=url,
                apply_url=url,
                title=job_title,
                company=company,
                location=clean(entry.get("region")),
                remote=True,
                employment_type=clean(entry.get("type")),
                description=html_to_text(entry.get("summary")),
                tags=list(dict.fromkeys(t for t in tags if t)),
                posted_at=_posted_at(entry),
                raw={k: entry.get(k) for k in _RAW_KEYS if entry.get(k)},
            )
        )
    return jobs


def fetch(http: HttpClient, boards: list[Board]) -> SourceResult:
    result = SourceResult()
    seen: set[str] = set()
    for i, category in enumerate(CATEGORIES):
        if i:
            http.pause()
        try:
            jobs = parse(http.get(FEED_URL.format(category=category)).text)
        except Exception as exc:  # noqa: BLE001 - one bad feed must not stop the others
            result.errors.append(f"{category}: {type(exc).__name__}: {exc}")
            log.warning("feed %s failed: %s", category, exc)
            continue
        new = [job for job in jobs if job.external_id not in seen]
        seen.update(job.external_id for job in new)
        result.jobs.extend(new)
        log.info("%s: %d items, %d new across feeds", category, len(jobs), len(new))
    if len(result.errors) == len(CATEGORIES):
        raise RuntimeError("all feeds failed: " + "; ".join(result.errors))
    return result
