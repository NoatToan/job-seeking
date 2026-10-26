import logging
import os
from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SkipSource, SourceResult
from job_crawler.text import clean, format_salary, html_to_text, parse_datetime

log = logging.getLogger(__name__)

SOURCE = "adzuna"
URL = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
COUNTRIES = ["au", "gb"]
PAGES = 3
RESULTS_PER_PAGE = 50
QUERY = "software developer"
CURRENCY = {"au": "AUD", "gb": "GBP"}


def _credentials() -> tuple[str, str] | None:
    app_id = os.environ.get("ADZUNA_APP_ID")
    app_key = os.environ.get("ADZUNA_APP_KEY")
    return (app_id, app_key) if app_id and app_key else None


def parse(payload: dict[str, Any], country: str) -> list[JobRecord]:
    jobs = []
    for item in payload.get("results") or []:
        url = item.get("redirect_url")
        if not item.get("id") or not url or not item.get("title"):
            continue
        title = html_to_text(item["title"]) or item["title"]
        location = clean((item.get("location") or {}).get("display_name"))
        contract = [clean(item.get("contract_time")), clean(item.get("contract_type"))]
        category = clean((item.get("category") or {}).get("label"))
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=f"{country}:{item['id']}",
                url=url,
                apply_url=url,
                title=title,
                company=clean((item.get("company") or {}).get("display_name")) or "Unknown",
                location=location,
                remote="remote" in f"{title} {location or ''}".lower(),
                employment_type=" ".join(c.replace("_", " ") for c in contract if c) or None,
                salary_text=format_salary(
                    item.get("salary_min"), item.get("salary_max"), CURRENCY.get(country)
                ),
                description=html_to_text(item.get("description")),
                tags=[category] if category else [],
                posted_at=parse_datetime(item.get("created")),
                raw=item,
            )
        )
    return jobs


def fetch(http: HttpClient, boards: list[Board]) -> SourceResult:
    creds = _credentials()
    if not creds:
        raise SkipSource("ADZUNA_APP_ID / ADZUNA_APP_KEY not set")
    app_id, app_key = creds
    result = SourceResult()
    requests = 0
    for country in COUNTRIES:
        for page in range(1, PAGES + 1):
            if requests:
                http.pause()
            requests += 1
            params = {
                "app_id": app_id,
                "app_key": app_key,
                "what": QUERY,
                "results_per_page": RESULTS_PER_PAGE,
            }
            try:
                payload = http.get_json(URL.format(country=country, page=page), params=params)
            except Exception as exc:  # noqa: BLE001 - keep going with the other country
                # Only the exception type: the request URL carries the API key.
                result.errors.append(f"{country} page {page}: {type(exc).__name__}")
                log.warning("adzuna %s page %d failed: %s", country, page, type(exc).__name__)
                break
            jobs = parse(payload, country)
            result.jobs.extend(jobs)
            log.info("adzuna %s page %d: %d jobs", country, page, len(jobs))
            if len(jobs) < RESULTS_PER_PAGE:
                break
    if result.errors and not result.jobs:
        raise RuntimeError("all requests failed: " + "; ".join(result.errors))
    return result
