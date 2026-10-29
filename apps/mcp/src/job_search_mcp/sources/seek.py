"""SEEK (Australia / New Zealand) via the public job-search JSON API its website calls."""

from typing import Literal

from .common import client, strip_html

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
    where: str,
    work_type: WorkType | None,
    remote_only: bool,
    days: int | None,
    country: Country,
    limit: int,
) -> dict:
    site_key, locale, _ = SITES[country]
    params: dict = {
        "siteKey": site_key,
        "locale": locale,
        "keywords": keywords,
        "where": where,
        "page": 1,
        "pageSize": min(limit, 100),
    }
    if work_type:
        params["worktype"] = WORK_TYPES[work_type]
    if remote_only:
        params["workarrangement"] = REMOTE_ARRANGEMENT
    if days:
        params["daterange"] = days
    return params


def parse(payload: dict, country: Country = "au") -> list[dict]:
    base = SITES[country][2]
    return [
        {
            "source": "seek",
            "title": job.get("title"),
            "company": (job.get("advertiser") or {}).get("description") or job.get("companyName"),
            "location": ", ".join(loc.get("label", "") for loc in job.get("locations") or []),
            "work_type": ", ".join(job.get("workTypes") or []),
            "arrangement": (job.get("workArrangements") or {}).get("displayText"),
            "salary": job.get("salaryLabel") or None,
            "posted_at": job.get("listingDate"),
            "summary": strip_html(job.get("teaser")),
            "url": f"{base}/job/{job.get('id')}",
        }
        for job in payload.get("data", [])
    ]


async def search(
    keywords: str,
    where: str = "All Australia",
    work_type: WorkType | None = None,
    remote_only: bool = False,
    days: int | None = None,
    country: Country = "au",
    limit: int = 20,
) -> list[dict]:
    params = search_params(keywords, where, work_type, remote_only, days, country, limit)
    async with client() as http:
        resp = await http.get(SEARCH_URL, params=params)
        resp.raise_for_status()
    return parse(resp.json(), country)[:limit]
