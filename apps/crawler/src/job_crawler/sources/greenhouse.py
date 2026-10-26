from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult
from job_crawler.sources._ats import fetch_boards
from job_crawler.text import clean, html_to_text, parse_datetime

SOURCE = "greenhouse"
URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"


def parse(payload: dict[str, Any], board: Board) -> list[JobRecord]:
    jobs = []
    for item in payload.get("jobs") or []:
        location = clean((item.get("location") or {}).get("name"))
        departments = [clean(d.get("name")) for d in item.get("departments") or []]
        url = item.get("absolute_url")
        if not item.get("id") or not url or not item.get("title"):
            continue
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=f"{board.slug}:{item['id']}",
                url=url,
                apply_url=url,
                title=item["title"].strip(),
                company=clean(item.get("company_name")) or board.company_name,
                location=location,
                remote="remote" in (location or "").lower(),
                description=html_to_text(item.get("content"), escaped=True),
                tags=[d for d in departments if d],
                posted_at=parse_datetime(item.get("first_published") or item.get("updated_at")),
                raw=item,
            )
        )
    return jobs


def fetch_board(http: HttpClient, board: Board) -> list[JobRecord]:
    return parse(http.get_json(URL.format(slug=board.slug), params={"content": "true"}), board)


def fetch(http: HttpClient, boards: list[Board]) -> SourceResult:
    return fetch_boards(http, boards, fetch_board)
