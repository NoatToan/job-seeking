"""We Work Remotely via its public RSS feeds."""

import xml.etree.ElementTree as ET
from typing import Literal

from .common import client, matches, strip_html

BASE = "https://weworkremotely.com"

CATEGORIES = {
    "all": "/remote-jobs.rss",
    "programming": "/categories/remote-programming-jobs.rss",
    "full_stack": "/categories/remote-full-stack-programming-jobs.rss",
    "back_end": "/categories/remote-back-end-programming-jobs.rss",
    "front_end": "/categories/remote-front-end-programming-jobs.rss",
    "devops": "/categories/remote-devops-sysadmin-jobs.rss",
    "design": "/categories/remote-design-jobs.rss",
    "product": "/categories/remote-product-jobs.rss",
    "management_finance": "/categories/remote-management-and-finance-jobs.rss",
    "customer_support": "/categories/remote-customer-support-jobs.rss",
    "sales_marketing": "/categories/remote-sales-and-marketing-jobs.rss",
}

Category = Literal[
    "all",
    "programming",
    "full_stack",
    "back_end",
    "front_end",
    "devops",
    "design",
    "product",
    "management_finance",
    "customer_support",
    "sales_marketing",
]
JobType = Literal["contract", "full_time"]


def parse(
    rss: str,
    keywords: str | None = None,
    job_type: JobType | None = None,
    limit: int = 20,
) -> list[dict]:
    wanted_type = {"contract": "contract", "full_time": "full-time"}.get(job_type or "")
    jobs = []
    for item in ET.fromstring(rss).iter("item"):
        raw_title = item.findtext("title") or ""
        company, _, title = raw_title.partition(": ")
        description = item.findtext("description")
        kind = item.findtext("type") or ""

        # Category feeds have no <type>; only the "all" feed can be filtered by job type.
        if wanted_type and kind.lower() != wanted_type:
            continue
        searchable = (
            raw_title,
            item.findtext("skills"),
            item.findtext("category"),
            strip_html(description, 5000),
        )
        if not matches(keywords, *searchable):
            continue

        jobs.append(
            {
                "source": "weworkremotely",
                "title": title or raw_title,
                "company": company if title else None,
                "location": item.findtext("region"),
                "country": (item.findtext("country") or "").strip() or None,
                "work_type": kind or None,
                "category": item.findtext("category"),
                "posted_at": item.findtext("pubDate"),
                "summary": strip_html(description),
                "url": item.findtext("link"),
            }
        )
        if len(jobs) >= limit:
            break
    return jobs


async def search(
    keywords: str | None = None,
    category: Category = "all",
    job_type: JobType | None = None,
    limit: int = 20,
) -> list[dict]:
    async with client() as http:
        resp = await http.get(BASE + CATEGORIES[category])
        resp.raise_for_status()
    return parse(resp.text, keywords, job_type, limit)
