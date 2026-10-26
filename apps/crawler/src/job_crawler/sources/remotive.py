"""Remotive public API (https://remotive.com/api/remote-jobs). Terms: link back to Remotive and
name it as the source (every job keeps its Remotive URL and the "Remotive" badge), and call it
only a few times a day — so it is used by the per-profile keyword search, capped per run."""

from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import JobRecord
from job_crawler.text import clean, html_to_text, parse_datetime

SOURCE = "remotive"
URL = "https://remotive.com/api/remote-jobs"


def parse(payload: dict[str, Any]) -> list[JobRecord]:
    jobs = []
    for item in payload.get("jobs") or []:
        url = item.get("url")
        if not item.get("id") or not url or not item.get("title"):
            continue
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=str(item["id"]),
                url=url,
                apply_url=url,
                title=item["title"].strip(),
                company=clean(item.get("company_name")) or "Unknown",
                location=clean(item.get("candidate_required_location")) or "Worldwide",
                remote=True,
                employment_type=clean((item.get("job_type") or "").replace("_", " ")),
                salary_text=clean(item.get("salary")),
                description=html_to_text(item.get("description")),
                tags=[t for t in item.get("tags") or [] if t][:10],
                posted_at=parse_datetime(item.get("publication_date")),
                raw={k: v for k, v in item.items() if k != "description"},
            )
        )
    return jobs


def search(http: HttpClient, keywords: str, limit: int = 100) -> list[JobRecord]:
    return parse(http.get_json(URL, params={"search": keywords, "limit": limit}))
