import logging
from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult
from job_crawler.text import clean, format_salary, html_to_text, parse_datetime

log = logging.getLogger(__name__)

SOURCE = "himalayas"
URL = "https://himalayas.app/jobs/api"
PAGE_SIZE = 20  # the API caps `limit` at 20
MAX_JOBS = 500


def parse(payload: dict[str, Any]) -> list[JobRecord]:
    jobs = []
    for item in payload.get("jobs") or []:
        url = item.get("guid") or item.get("applicationLink")
        if not url or not item.get("title"):
            continue
        locations = [loc for loc in item.get("locationRestrictions") or [] if loc]
        tags = (item.get("parentCategories") or []) + (item.get("seniority") or [])
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=url,
                url=url,
                apply_url=item.get("applicationLink") or url,
                title=item["title"].strip(),
                company=clean(item.get("companyName")) or "Unknown",
                location=", ".join(locations) if locations else "Worldwide",
                remote=True,
                employment_type=clean(item.get("employmentType")),
                salary_text=format_salary(
                    item.get("minSalary"),
                    item.get("maxSalary"),
                    item.get("currency"),
                    item.get("salaryPeriod"),
                ),
                description=html_to_text(item.get("description")) or clean(item.get("excerpt")),
                tags=list(dict.fromkeys(t for t in tags if t)),
                posted_at=parse_datetime(item.get("pubDate")),
                raw=item,
            )
        )
    return jobs


def fetch(http: HttpClient, boards: list[Board], max_jobs: int = MAX_JOBS) -> SourceResult:
    result = SourceResult()
    seen: set[str] = set()
    cursor: str | None = None
    offset = 0
    while len(result.jobs) < max_jobs:
        if offset:
            http.pause()
        params: dict[str, Any] = {"limit": PAGE_SIZE}
        # The API prefers cursor pagination (offset is deprecated); offset=0 starts page one.
        if cursor:
            params["cursor"] = cursor
        else:
            params["offset"] = offset
        payload = http.get_json(URL, params=params)
        page = parse(payload)
        if not page:
            break
        for job in page:
            if job.external_id not in seen:
                seen.add(job.external_id)
                result.jobs.append(job)
        offset += PAGE_SIZE
        cursor = payload.get("nextCursor")
        if not cursor and offset >= int(payload.get("totalCount") or 0):
            break
    result.jobs = result.jobs[:max_jobs]
    log.info("himalayas: %d jobs", len(result.jobs))
    return result
