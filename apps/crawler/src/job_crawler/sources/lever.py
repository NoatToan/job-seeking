from typing import Any

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult
from job_crawler.sources._ats import fetch_boards
from job_crawler.text import clean, format_salary, html_to_text, parse_datetime

SOURCE = "lever"
URL = "https://api.lever.co/v0/postings/{slug}"


def _salary(item: dict[str, Any]) -> str | None:
    salary = item.get("salaryRange") or {}
    if not salary.get("min") and not salary.get("max"):
        return clean(item.get("salaryDescriptionPlain"))
    interval = (salary.get("interval") or "").replace("-", " ") or None
    return format_salary(salary.get("min"), salary.get("max"), salary.get("currency"), interval)


def _description(item: dict[str, Any]) -> str | None:
    parts = [html_to_text(item.get("description"))]
    for block in item.get("lists") or []:
        heading = clean(block.get("text"))
        body = html_to_text(f"<ul>{block.get('content') or ''}</ul>")
        parts.append("\n".join(p for p in (heading, body) if p))
    parts.append(html_to_text(item.get("additional")))
    text = "\n\n".join(p for p in parts if p)
    return text or None


def parse(payload: list[dict[str, Any]], board: Board) -> list[JobRecord]:
    jobs = []
    for item in payload or []:
        url = item.get("hostedUrl")
        if not item.get("id") or not url or not item.get("text"):
            continue
        categories = item.get("categories") or {}
        location = clean(categories.get("location"))
        workplace = (item.get("workplaceType") or "").lower()
        tags = [clean(categories.get(k)) for k in ("team", "department")]
        jobs.append(
            JobRecord(
                source=SOURCE,
                external_id=f"{board.slug}:{item['id']}",
                url=url,
                apply_url=item.get("applyUrl") or url,
                title=item["text"].strip(),
                company=board.company_name,
                location=location,
                remote=workplace == "remote" or "remote" in (location or "").lower(),
                employment_type=clean(categories.get("commitment")),
                salary_text=_salary(item),
                description=_description(item),
                tags=list(dict.fromkeys(t for t in tags if t)),
                posted_at=parse_datetime(item.get("createdAt")),
                raw=item,
            )
        )
    return jobs


def fetch_board(http: HttpClient, board: Board) -> list[JobRecord]:
    return parse(http.get_json(URL.format(slug=board.slug), params={"mode": "json"}), board)


def fetch(http: HttpClient, boards: list[Board]) -> SourceResult:
    return fetch_boards(http, boards, fetch_board)
