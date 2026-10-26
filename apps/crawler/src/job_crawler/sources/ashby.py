import re
from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult
from job_crawler.sources._ats import fetch_boards
from job_crawler.text import clean, html_to_text, parse_datetime

SOURCE = "ashby"
URL = "https://api.ashbyhq.com/posting-api/job-board/{slug}"


def _employment_type(value: str | None) -> str | None:
    # "FullTime" -> "Full Time"
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value) if value else None


def parse(payload: dict[str, Any], board: Board) -> list[JobRecord]:
    jobs = []
    for item in payload.get("jobs") or []:
        if item.get("isListed") is False:
            continue
        url = item.get("jobUrl")
        if not item.get("id") or not url or not item.get("title"):
            continue
        compensation = item.get("compensation") or {}
        location = clean(item.get("location"))
        workplace = (item.get("workplaceType") or "").lower()
        tags = [clean(item.get("department")), clean(item.get("team"))]
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=f"{board.slug}:{item['id']}",
                url=url,
                apply_url=item.get("applyUrl") or url,
                title=item["title"].strip(),
                company=board.company_name,
                location=location,
                remote=bool(item.get("isRemote")) or workplace == "remote",
                employment_type=_employment_type(item.get("employmentType")),
                salary_text=clean(
                    compensation.get("scrapeableCompensationSalarySummary")
                    or compensation.get("compensationTierSummary")
                ),
                description=clean(item.get("descriptionPlain"))
                or html_to_text(item.get("descriptionHtml")),
                tags=list(dict.fromkeys(t for t in tags if t)),
                posted_at=parse_datetime(item.get("publishedAt")),
                raw=item,
            )
        )
    return jobs


def fetch_board(http: HttpClient, board: Board) -> list[JobRecord]:
    url = URL.format(slug=board.slug)
    return parse(http.get_json(url, params={"includeCompensation": "true"}), board)


def fetch(http: HttpClient, boards: list[Board]) -> SourceResult:
    return fetch_boards(http, boards, fetch_board)
