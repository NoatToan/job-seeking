"""Search URL builders and result-page parsers for session sites (pure, tested offline)."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from html import unescape
from urllib.parse import quote, urlencode, urljoin

from bs4 import BeautifulSoup, Tag

from job_crawler.models import JobRecord
from job_crawler.text import clean, format_salary, parse_datetime


@dataclass(frozen=True)
class SearchProfile:
    """Row of `search_profiles` (what the user is looking for)."""

    id: int
    name: str
    keywords: str
    locations: list[str]
    remote_only: bool
    sources: list[str]
    #: ISO country code of the candidate (e.g. "VN"): hide remote jobs not open to it
    candidate_country: str | None = None


def _text(node: Tag | None) -> str | None:
    # LinkedIn double-encodes some entities (e.g. "&#8211;" inside the text)
    return clean(unescape(node.get_text(" ", strip=True))) if node else None


def plain_keywords(keywords: str) -> str:
    """Site search boxes don't understand our web-search syntax: drop -excluded words and quotes."""
    words = [w for w in keywords.replace('"', " ").split() if not w.startswith("-")]
    return " ".join(w for w in words if w.upper() != "OR")


# --- LinkedIn ---------------------------------------------------------------------------------

LINKEDIN = "linkedin"
_LINKEDIN_JOB_ID = re.compile(r"/jobs/view/(?:[^/?]*-)?(\d+)")


def linkedin_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    params = {
        "keywords": plain_keywords(profile.keywords),
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
    # logged in: data-occludable-job-id cards; logged out: base-card with a jobPosting urn
    cards = soup.select(
        "[data-occludable-job-id], [data-job-id], [data-entity-urn*='jobPosting'],"
        " li:has(a[href*='/jobs/view/'])"
    )
    for card in cards:
        urn = str(card.get("data-entity-urn") or "")
        job_id = (
            card.get("data-occludable-job-id")
            or card.get("data-job-id")
            or (urn.rsplit(":", 1)[-1] if urn else None)
        )
        link = card.select_one("a[href*='/jobs/view/']")
        if not job_id and link:
            m = _LINKEDIN_JOB_ID.search(str(link.get("href", "")))
            job_id = m.group(1) if m else None
        if not job_id or not str(job_id).isdigit() or job_id in jobs:
            continue
        title = _text(
            card.select_one(
                ".job-card-list__title, .job-card-container__link strong, .base-search-card__title"
            )
        )
        title = (
            title
            or (clean(unescape(str(link.get("aria-label") or ""))) if link else None)
            or _text(link)
        )
        if not title:
            continue
        company = _text(
            card.select_one(
                ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description,"
                " .base-search-card__subtitle"
            )
        )
        location = _text(
            card.select_one(
                ".artdeco-entity-lockup__caption, .job-card-container__metadata-item,"
                " .job-search-card__location"
            )
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
SEEK_BASE = "https://au.seek.com"  # moved from www.seek.com.au (redirects) in 2026


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def seek_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    path = f"/{quote(_slug(plain_keywords(profile.keywords)))}-jobs"
    if location:
        path += f"/in-{quote(_slug(location))}"
    params = {"daterange": "1", "sortmode": "ListedDate", "page": str(page + 1)}
    if profile.remote_only:
        params["where"] = "Remote"  # Seek's work-from-home filter is a location term
    return SEEK_BASE + path + "?" + urlencode(params)


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
        url = urljoin(SEEK_BASE, f"/job/{job_id}")
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


# --- Arc.dev (public pages, all remote; data is in the Next.js page JSON) ---------------------

ARC = "arc"
_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def arc_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    params = {"search": plain_keywords(profile.keywords)}
    if page:
        params["page"] = str(page + 1)
    return "https://arc.dev/remote-jobs?" + urlencode(params)


def parse_arc(html: str) -> list[JobRecord]:
    m = _NEXT_DATA.search(html)
    if not m:
        return []
    try:
        props = json.loads(m.group(1))["props"]["pageProps"]
    except (ValueError, KeyError, TypeError):
        return []
    jobs: dict[str, JobRecord] = {}
    for item in (props.get("arcJobs") or []) + (props.get("externalJobs") or []):
        key, slug, title = item.get("randomKey"), item.get("urlString"), clean(item.get("title"))
        if not key or not slug or not title or key in jobs:
            continue
        url = f"https://arc.dev/remote-jobs/details/{slug}-{key}"
        countries = item.get("requiredCountries") or []
        jobs[key] = JobRecord(
            source=ARC,
            external_id=key,
            url=url,
            apply_url=url,
            title=title,
            company=clean((item.get("company") or {}).get("name")) or "Confidential (via Arc)",
            location="Remote" + (f" ({', '.join(countries)})" if countries else ""),
            remote=True,
            employment_type=clean(item.get("jobType")),
            salary_text=format_salary(
                item.get("minAnnualSalary"), item.get("maxAnnualSalary"), "USD", "year"
            ),
            tags=[c["name"] for c in item.get("categories") or [] if c.get("name")],
            posted_at=parse_datetime(item.get("postedAt")),
            raw=item,
        )
    return list(jobs.values())


# --- Glassdoor (Cloudflare-protected: the user passes the check in a visible window) -----------

GLASSDOOR = "glassdoor"


def glassdoor_search_url(profile: SearchProfile, location: str | None, page: int) -> str:
    params = {"sc.keyword": plain_keywords(profile.keywords), "fromAge": "1"}
    if location:
        params["locKeyword"] = location
    if profile.remote_only:
        params["remoteWorkType"] = "1"
    return "https://www.glassdoor.com/Job/jobs.htm?" + urlencode(params)


def parse_glassdoor(html: str) -> list[JobRecord]:
    soup = BeautifulSoup(html, "html.parser")
    jobs: dict[str, JobRecord] = {}
    for card in soup.select("li[data-test='jobListing'], [data-jobid]"):
        job_id = str(card.get("data-jobid") or "")
        title_link = card.select_one("a[data-test='job-title'], a[data-test='job-link']")
        if not job_id.isdigit() or not title_link or job_id in jobs:
            continue
        href = str(title_link.get("href") or "")
        url = (
            urljoin("https://www.glassdoor.com", href)
            if href
            else (f"https://www.glassdoor.com/job-listing/j?jl={job_id}")
        )
        location = _text(card.select_one("[data-test='emp-location']"))
        jobs[job_id] = JobRecord(
            source=GLASSDOOR,
            external_id=job_id,
            url=url,
            apply_url=url,
            title=_text(title_link) or "",
            company=_text(
                card.select_one(
                    "[class*='EmployerProfile_compactEmployerName'], [data-test='employer-name']"
                )
            )
            or "Unknown",
            location=location,
            remote="remote" in (location or "").lower(),
            salary_text=_text(card.select_one("[data-test='detailSalary']")),
            description=_text(
                card.select_one("[data-test='descSnippet'], [class*='jobDescriptionSnippet']")
            ),
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
    #: CSS selector that is present once search results have rendered.
    result_selector: str = "body"
    #: result pages this site supports per search (Glassdoor uses "load more", not pages)
    max_pages: int = 5


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
        result_selector="[data-occludable-job-id], [data-entity-urn*='jobPosting']",
    ),
    SEEK: Site(
        id=SEEK,
        login_url=f"{SEEK_BASE}/oauth/login",
        search_url=seek_search_url,
        parse=parse_seek,
        block_markers=("/challenge", "captcha"),
        result_selector="article[data-job-id], [data-automation='searchResults']",
    ),
    ARC: Site(
        id=ARC,
        login_url="https://arc.dev/login",
        search_url=arc_search_url,
        parse=parse_arc,
        block_markers=("captcha",),
        result_selector="#__NEXT_DATA__",
    ),
    GLASSDOOR: Site(
        id=GLASSDOOR,
        login_url="https://www.glassdoor.com/profile/login_input.htm",
        search_url=glassdoor_search_url,
        parse=parse_glassdoor,
        block_markers=("/profile/login", "captcha"),
        result_selector="li[data-test='jobListing'], [data-test='jobsList']",
        max_pages=1,
    ),
}
