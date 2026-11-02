"""SEEK (Australia / New Zealand) via the public job-search JSON API its website calls.

The parser and param builder are shared with `apps/crawler` (`job_crawler.sources.seek`, a path
dependency of this package) and `apps/api`'s live search; see docs/product/ARCHITECTURE.md D11.
This module only adapts the shared `JobRecord`s into this MCP server's own tool-output shape, so
Claude's tool output is unchanged.
"""

from job_crawler.sources import seek as crawler_seek

from .common import client

SEARCH_URL = crawler_seek.SEARCH_URL
search_params = crawler_seek.search_params
WorkType = crawler_seek.WorkType
Country = crawler_seek.Country


def parse(payload: dict, country: Country = "au") -> list[dict]:
    return [
        {
            "source": "seek",
            "title": record.title,
            "company": record.company,
            "location": record.location,
            "work_type": record.employment_type,
            "arrangement": (record.raw.get("workArrangements") or {}).get("displayText"),
            "salary": record.salary_text,
            "posted_at": record.raw.get("listingDate"),
            "summary": record.description,
            "url": record.url,
        }
        for record in crawler_seek.parse(payload, country)
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
