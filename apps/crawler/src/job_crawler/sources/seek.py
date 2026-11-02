"""SEEK (Australia / New Zealand) via the public job-search JSON API its website calls.

Shared by `job_crawler.profile_search` (one page per saved search profile), `apps/api`'s live
search and `apps/mcp` (which adapts `parse()`'s `JobRecord`s into its own tool output shape; see
`job_search_mcp.sources.seek`). No browser needed: the JSON API isn't behind Cloudflare.
"""

import logging
from typing import Any, Literal

from job_crawler.http import HttpClient
from job_crawler.models import JobRecord
from job_crawler.text import clean, html_to_text, parse_datetime

log = logging.getLogger(__name__)

SOURCE = "seek"
SEARCH_URL = "https://www.seek.com.au/api/jobsearch/v5/search"

WORK_TYPES = {"full_time": 242, "part_time": 243, "contract": 244, "casual": 245}
REMOTE_ARRANGEMENT = 3
SITES = {
    "au": ("AU-Main", "en-AU", "https://www.seek.com.au"),
    "nz": ("NZ-Main", "en-NZ", "https://www.seek.co.nz"),
}

WorkType = Literal["full_time", "part_time", "contract", "casual"]
Country = Literal["au", "nz"]


def search_params(
    keywords: str,
    where: str = "All Australia",
    work_type: WorkType | None = None,
    remote_only: bool = False,
    days: int | None = None,
    country: Country = "au",
    limit: int = 20,
    page: int = 1,
) -> dict[str, Any]:
    site_key, locale, _ = SITES[country]
    params: dict[str, Any] = {
        "siteKey": site_key,
        "locale": locale,
        "keywords": keywords,
        "where": where,
        "page": page,
        "pageSize": min(limit, 100),
    }
    if work_type:
        params["worktype"] = WORK_TYPES[work_type]
    if remote_only:
        params["workarrangement"] = REMOTE_ARRANGEMENT
    if days:
        params["daterange"] = days
    return params


def parse(payload: dict[str, Any], country: Country = "au") -> list[JobRecord]:
    base = SITES[country][2]
    jobs = []
    for job in payload.get("data") or []:
        job_id = job.get("id")
        title = clean(job.get("title"))
        if not job_id or not title:
            continue
        location = ", ".join(loc.get("label", "") for loc in job.get("locations") or []) or None
        arrangement = (job.get("workArrangements") or {}).get("displayText") or ""
        url = f"{base}/job/{job_id}"
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=str(job_id),
                url=url,
                apply_url=url,
                title=title,
                company=clean((job.get("advertiser") or {}).get("description"))
                or clean(job.get("companyName"))
                or "Private advertiser",
                location=location,
                remote="remote" in f"{location} {arrangement}".lower(),
                employment_type=", ".join(job.get("workTypes") or []) or None,
                salary_text=clean(job.get("salaryLabel")),
                description=html_to_text(job.get("teaser")),
                tags=[],
                posted_at=parse_datetime(job.get("listingDate")),
                raw=job,
            )
        )
    return jobs


def search(
    http: HttpClient,
    keywords: str,
    limit: int = 20,
    page: int = 1,
    country: Country = "au",
) -> list[JobRecord]:
    params = search_params(keywords, limit=limit, page=page, country=country)
    payload = http.get_json(SEARCH_URL, params=params)
    return parse(payload, country)[:limit]
