"""MCP server: free job search across SEEK, We Work Remotely and Arc.dev.

LinkedIn / Glassdoor / Indeed are covered by the separate `jobspy-mcp` server
(see the repo-root .mcp.json).
"""

import asyncio
from typing import Literal

from mcp.server import MCPServer

from .sources import arc, seek, wwr

mcp = MCPServer("job-seeking")


@mcp.tool()
async def search_seek(
    keywords: str,
    where: str = "All Australia",
    work_type: seek.WorkType | None = None,
    remote_only: bool = False,
    days: int | None = None,
    country: Literal["au", "nz"] = "au",
    limit: int = 20,
) -> list[dict]:
    """Search SEEK (Australia/NZ) jobs.

    work_type: full_time | part_time | contract | casual
        ("contract" = SEEK's Contract/Temp, best for freelancers).
    where: a suburb, city or state, e.g. "Sydney NSW", or "All Australia".
    days: only jobs listed in the last N days (1, 3, 7, 14, 31).
    """
    return await seek.search(keywords, where, work_type, remote_only, days, country, limit)


@mcp.tool()
async def search_weworkremotely(
    keywords: str | None = None,
    category: wwr.Category = "all",
    job_type: Literal["contract", "full_time"] | None = None,
    limit: int = 20,
) -> list[dict]:
    """Search We Work Remotely (remote-only jobs).

    Reads the latest ~100 postings of the chosen category RSS feed and filters them by keywords
    (all words must match title, skills or description). Only category="all" carries job types.
    """
    return await wwr.search(keywords, category, job_type, limit)


@mcp.tool()
async def search_arc(
    skill: str | None = None,
    keywords: str | None = None,
    job_type: Literal["contract", "permanent"] | None = None,
    limit: int = 20,
) -> list[dict]:
    """Search Arc.dev remote developer jobs.

    skill: Arc skill page such as "react", "python", "node", "aws", "flutter" (one skill).
    keywords: extra words that must appear in the title or skill tags.
    job_type: "contract" for freelance/contract roles, "permanent" for full-time.
    """
    return await arc.search(skill, keywords, job_type, limit)


@mcp.tool()
async def search_freelance_jobs(keywords: str, limit_per_source: int = 10) -> dict:
    """Search contract/freelance jobs on SEEK, We Work Remotely and Arc.dev at once.

    keywords: e.g. "react", "python developer". For Arc the first word is used as the skill page.
    Returns results grouped by source; a source that fails reports its error instead of results.
    """
    tasks = {
        "seek": seek.search(keywords, work_type="contract", limit=limit_per_source),
        "weworkremotely": wwr.search(keywords, job_type="contract", limit=limit_per_source),
        "arc": arc.search(skill=keywords.split()[0], job_type="contract", limit=limit_per_source),
    }
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    return {
        name: {"error": f"{type(res).__name__}: {res}"} if isinstance(res, Exception) else res
        for name, res in zip(tasks, results, strict=True)
    }


def main() -> None:
    mcp.run()
