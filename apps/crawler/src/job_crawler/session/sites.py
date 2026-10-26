"""Search URL builders and result-page parsers for session sites (pure, tested offline)."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote, urlencode, urljoin

from bs4 import BeautifulSoup, Tag

from job_crawler.models import JobRecord
from job_crawler.text import clean


@dataclass(frozen=True)
class SearchProfile:
    """Row of `search_profiles` (what the user is looking for)."""

    id: int
    name: str
    keywords: str
    locations: list[str]
    remote_only: bool
    sources: list[str]


def _text(node: Tag | None) -> str | None:
    return clean(node.get_text(" ", strip=True)) if node else None


def _plain_keywords(keywords: str) -> str:
    """Site search boxes don't understand our web-search syntax: drop -excluded words and quotes."""
    words = [w for w in keywords.replace('"', " ").split() if not w.startswith("-")]
    return " ".join(w for w in words if w.upper() != "OR")


# --- LinkedIn ---------------------------------------------------------------------------------

LINKEDIN = "linkedin"
_LINKEDIN_JOB_ID = re.compile(r"/jobs/view/(?:[^/?]*-)?(\d+)")


def linkedin_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    params = {
        "keywords": _plain_keywords(profile.keywords),
        "f_TPR": "r86400",  # posted in the last 24 h: the crawl runs daily
        "sortBy": "DD",
        "start": str(page * 25),
    }
    if location:
        params["location"] = location
    if profile.remote_only:
        params["f_WT"] = "2"
    return "https://www.linkedin.com/jobs/search/?" + urlencode(params)


def parse_linkedin(html: str) -> list[JobRecord]:
    soup = BeautifulSoup(html, "html.parser")
    jobs: dict[str, JobRecord] = {}
    cards = soup.select("[data-occludable-job-id], [data-job-id], li:has(a[href*='/jobs/view/'])")
    for card in cards:
        job_id = card.get("data-occludable-job-id") or card.get("data-job-id")
        link = card.select_one("a[href*='/jobs/view/']")
        if not job_id and link:
            m = _LINKEDIN_JOB_ID.search(str(link.get("href", "")))
            job_id = m.group(1) if m else None
        if not job_id or not str(job_id).isdigit() or job_id in jobs:
            continue
        title = _text(card.select_one(".job-card-list__title, .job-card-container__link strong"))
        title = title or (clean(link.get("aria-label")) if link else None) or _text(link)
        if not title:
            continue
        company = _text(
            card.select_one(
                ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description"
            )
        )
        location = _text(
            card.select_one(".artdeco-entity-lockup__caption, .job-card-container__metadata-item")
        )
        url = f"https://www.linkedin.com/jobs/view/{job_id}/"
        jobs[str(job_id)] = JobRecord(
            source=LINKEDIN,
            external_id=str(job_id),
            url=url,
            apply_url=url,
            title=title,
            company=company or "Unknown",
            location=location,
            remote="remote" in (location or "").lower(),
            raw={"card_text": _text(card)},
        )
    return list(jobs.values())


# --- Seek -------------------------------------------------------------------------------------

SEEK = "seek"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def seek_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    path = f"/{quote(_slug(_plain_keywords(profile.keywords)))}-jobs"
    if location:
        path += f"/in-{quote(_slug(location))}"
    params = {"daterange": "1", "sortmode": "ListedDate", "page": str(page + 1)}
    if profile.remote_only:
        params["where"] = "Remote"  # Seek's work-from-home filter is a location term
    return "https://www.seek.com.au" + path + "?" + urlencode(params)


def parse_seek(html: str) -> list[JobRecord]:
    soup = BeautifulSoup(html, "html.parser")
    jobs: dict[str, JobRecord] = {}
    for card in soup.select("article[data-job-id], [data-card-type='JobCard'][data-job-id]"):
        job_id = str(card.get("data-job-id") or "")
        title_link = card.select_one("a[data-automation='jobTitle']")
        if not job_id.isdigit() or not title_link or job_id in jobs:
            continue
        location = (
            ", ".join(
                t for t in (_text(n) for n in card.select("[data-automation='jobLocation']")) if t
            )
            or None
        )
        work_type = _text(card.select_one("[data-automation='jobWorkType']"))
        url = urljoin("https://www.seek.com.au", f"/job/{job_id}")
        jobs[job_id] = JobRecord(
            source=SEEK,
            external_id=job_id,
            url=url,
            apply_url=f"{url}/apply",
            title=_text(title_link) or "",
            company=_text(card.select_one("[data-automation='jobCompany']"))
            or "Private advertiser",
            location=location,
            remote=any(
                w in f"{location} {work_type}".lower() for w in ("remote", "work from home")
            ),
            employment_type=work_type,
            salary_text=_text(card.select_one("[data-automation='jobSalary']")),
            description=_text(card.select_one("[data-automation='jobShortDescription']")),
            raw={"card_text": _text(card)},
        )
    return [j for j in jobs.values() if j.title]


@dataclass(frozen=True)
class Site:
    id: str
    login_url: str
    search_url: Callable[[SearchProfile, str | None, int], str]
    parse: Callable[[str], list[JobRecord]]
    #: URL fragments that mean "not logged in" or "security check" — the user must act.
    block_markers: tuple[str, ...]


#: Page titles of bot-check interstitials (Cloudflare, generic CAPTCHA pages).
BLOCK_TITLES = ("just a moment", "attention required", "security check", "captcha")


def is_blocked(site: Site, url: str, title: str) -> bool:
    """True when the page is a login wall or a human check the user has to handle themselves."""
    title = title.lower()
    return any(m in url for m in site.block_markers) or any(t in title for t in BLOCK_TITLES)


SITES: dict[str, Site] = {
    LINKEDIN: Site(
        id=LINKEDIN,
        login_url="https://www.linkedin.com/login",
        search_url=linkedin_search_url,
        parse=parse_linkedin,
        block_markers=("/checkpoint", "/authwall", "/login", "/uas/login"),
    ),
    SEEK: Site(
        id=SEEK,
        login_url="https://www.seek.com.au/oauth/login",
        search_url=seek_search_url,
        parse=parse_seek,
        block_markers=("/challenge", "captcha"),
    ),
}
