"""MCP server: free job search across SEEK, We Work Remotely and Arc.dev, plus (M3-08) the
signed-in user's own unified-job-crawler data when `UJC_API_URL`/`UJC_TOKEN` are set.

LinkedIn / Glassdoor / Indeed are covered by the separate `jobspy-mcp` server
(see the repo-root .mcp.json).
"""

import asyncio
from typing import Any, Literal

from mcp.server import MCPServer

from . import ujc_client
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


def register_user_data_tools(
    server: MCPServer, client: ujc_client.UjcApiClient | None = None
) -> None:
    """Registers the `my_*`/`save_job`/`update_application` tools on `server`, backed by
    `client` (a fresh `UjcApiClient()` reading `UJC_API_URL`/`UJC_TOKEN` from the environment by
    default). Called unconditionally here so tests can register these tools on a throwaway
    `MCPServer` with a mocked transport without setting real env vars; the module-level `mcp`
    below only calls it when `ujc_client.enabled()`."""
    api = client or ujc_client.UjcApiClient()

    @server.tool()
    async def my_feed(cursor: str | None = None, q: str | None = None) -> dict[str, Any]:
        """Your personalised job feed (jobs matching your saved keywords), newest first.

        cursor: pass back the previous page's `nextCursor` to continue.
        q: optional extra free-text filter on top of your saved keywords.
        """
        return await api.get_feed(cursor, q)

    @server.tool()
    async def my_job(job_id: str) -> dict[str, Any]:
        """Full detail (including description) for one job by id, from `my_feed`/`my_live_search`
        results."""
        return await api.get_job(job_id)

    @server.tool()
    async def my_live_search(q: str, cursor: str | None = None) -> dict[str, Any]:
        """Searches every configured platform's own search API right now (not just what's
        already in your feed).

        cursor: pass back the previous page's `nextCursor` to continue.
        """
        return await api.live_search(q, cursor)

    @server.tool()
    async def my_applications(status: str | None = None) -> dict[str, Any]:
        """Your tracked applications.

        status: optional filter — one of saved, applied, interviewing, offer, rejected,
            withdrawn.
        """
        return await api.list_applications(status)

    @server.tool()
    async def save_job(job_id: str, note: str | None = None) -> dict[str, Any]:
        """Tracks a job (status `saved`) by id. Idempotent: an already-tracked job is returned
        unchanged rather than duplicated."""
        return await api.save_job(job_id, note)

    @server.tool()
    async def update_application(
        application_id: str, status: str | None = None, note: str | None = None
    ) -> dict[str, Any]:
        """Updates a tracked application's status and/or note. Provide at least one of `status`
        (saved, applied, interviewing, offer, rejected, withdrawn) or `note`."""
        return await api.update_application(application_id, status, note)


if ujc_client.enabled():
    register_user_data_tools(mcp)


def main() -> None:
    mcp.run()
