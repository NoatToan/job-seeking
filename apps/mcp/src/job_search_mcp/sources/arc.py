"""Arc.dev via the job data embedded (`__NEXT_DATA__`) in its server-rendered listing pages."""

import json
import re
from datetime import UTC, datetime
from typing import Literal

from .common import client, matches

BASE = "https://arc.dev"
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

JobType = Literal["contract", "permanent"]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _salary(job: dict) -> str | None:
    hourly = (job.get("minHourlyRate"), job.get("maxHourlyRate"))
    annual = (job.get("minAnnualSalary"), job.get("maxAnnualSalary"))
    if any(hourly):
        return f"${hourly[0] or '?'}–{hourly[1] or '?'}/hr"
    if any(annual):
        return f"${annual[0] or '?'}–{annual[1] or '?'}/yr"
    return None


def parse(
    page_html: str,
    keywords: str | None = None,
    job_type: JobType | None = None,
    limit: int = 20,
) -> list[dict]:
    match = NEXT_DATA.search(page_html)
    if not match:
        raise RuntimeError("Arc page layout changed: __NEXT_DATA__ not found")
    props = json.loads(match.group(1))["props"]["pageProps"]

    listed = [(j, True) for j in props.get("arcJobs", [])]
    listed += [(j, False) for j in props.get("externalJobs", [])]
    jobs = []
    for job, exclusive in listed:
        if job_type and job.get("jobType") != job_type:
            continue
        categories = [c.get("name", "") for c in job.get("categories") or []]
        if not matches(keywords, job.get("title"), *categories):
            continue

        posted = job.get("postedAt")
        levels = job.get("experienceLevel") or ", ".join(job.get("experienceLevels") or [])
        jobs.append(
            {
                "source": "arc",
                "title": job.get("title"),
                "company": (job.get("company") or {}).get("name"),
                "location": ", ".join(job.get("requiredCountries") or []) or "Worldwide",
                "work_type": job.get("jobType"),
                "experience": levels or None,
                "salary": _salary(job),
                "skills": categories[:8],
                "arc_exclusive": exclusive,
                "posted_at": datetime.fromtimestamp(posted, UTC).isoformat() if posted else None,
                "url": f"{BASE}/remote-jobs/details/{job.get('urlString')}-{job.get('randomKey')}",
            }
        )
        if len(jobs) >= limit:
            break
    return jobs


async def search(
    skill: str | None = None,
    keywords: str | None = None,
    job_type: JobType | None = None,
    limit: int = 20,
) -> list[dict]:
    """`skill` picks Arc's skill page (e.g. "react", "python", "aws")."""
    path = f"/remote-jobs/{slug(skill)}" if skill else "/remote-jobs"
    params = {"jobTypes": job_type} if job_type else {}

    async with client() as http:
        resp = await http.get(BASE + path, params=params)
        # Arc redirects skill aliases (react -> reactjs) and drops the query string on the way.
        if params and not resp.url.params:
            resp = await http.get(resp.url, params=params)
        resp.raise_for_status()

    # An unknown skill redirects to the generic list, so filter by the skill locally instead.
    if skill and resp.url.path.rstrip("/") == "/remote-jobs":
        keywords = f"{skill} {keywords or ''}"
    return parse(resp.text, keywords, job_type, limit)
