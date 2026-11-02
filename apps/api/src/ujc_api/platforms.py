"""The platform catalogue (`GET /api/platforms`, M3-01).

Mirrors `packages/core/src/sources.ts` `SOURCES` (same 11 ids — keep both lists in sync) grouped
by how a user "connects" to each one (docs/product/ARCHITECTURE.md §6):

- `public`:  always-on built-in sources, no connection needed.
- `api_key`: Adzuna — a user may add their own app id/key (encrypted in `platform_connections`).
- `oauth`:   Upwork — OAuth connect, gated by `UPWORK_ENABLED` + client id/secret.
- `runner`:  LinkedIn / Glassdoor — companion runner pairing (M3-06, `/account/#runner`); this
  schema has no per-site status, so `connected` here just means "at least one active runner".
"""

from dataclasses import dataclass
from typing import Literal

import psycopg

from ujc_api.dto import source_dto
from ujc_api.settings import Settings

PlatformKind = Literal["public", "api_key", "oauth", "runner"]


@dataclass(frozen=True, slots=True)
class PlatformMeta:
    id: str
    label: str
    kind: PlatformKind
    homepage: str
    description: str


_ALWAYS_ON = "Built in. Always on."
_ALWAYS_ON_SEARCH = "Built in keyword search. Always on."

# Order matches packages/core/src/sources.ts SOURCES, plus upwork at the end.
CATALOGUE: tuple[PlatformMeta, ...] = (
    PlatformMeta(
        "weworkremotely", "We Work Remotely", "public", "https://weworkremotely.com", _ALWAYS_ON
    ),
    PlatformMeta("greenhouse", "Greenhouse", "public", "https://www.greenhouse.com", _ALWAYS_ON),
    PlatformMeta("lever", "Lever", "public", "https://www.lever.co", _ALWAYS_ON),
    PlatformMeta("ashby", "Ashby", "public", "https://www.ashbyhq.com", _ALWAYS_ON),
    PlatformMeta("himalayas", "Himalayas", "public", "https://himalayas.app", _ALWAYS_ON),
    PlatformMeta("remotive", "Remotive", "public", "https://remotive.com", _ALWAYS_ON),
    PlatformMeta("seek", "Seek", "public", "https://au.seek.com", _ALWAYS_ON_SEARCH),
    PlatformMeta("arc", "Arc", "public", "https://arc.dev", _ALWAYS_ON_SEARCH),
    PlatformMeta(
        "adzuna",
        "Adzuna",
        "api_key",
        "https://www.adzuna.com",
        "Add your own app id/key for more countries and a higher rate limit.",
    ),
    PlatformMeta(
        "linkedin",
        "LinkedIn",
        "runner",
        "https://www.linkedin.com",
        "Local runner — crawl with your own login via a companion runner on your machine.",
    ),
    PlatformMeta(
        "glassdoor",
        "Glassdoor",
        "runner",
        "https://www.glassdoor.com",
        "Local runner — crawl with your own login via a companion runner on your machine.",
    ),
    PlatformMeta(
        "upwork",
        "Upwork",
        "oauth",
        "https://www.upwork.com",
        "Use the official Upwork MCP in your own Claude, or connect for in-app search.",
    ),
)


def _source_status_by_id(conn: psycopg.Connection) -> dict[str, dict]:
    rows = conn.execute(
        """
        WITH job_counts AS (
            SELECT source, count(*) AS total, max(first_seen_at) AS last_seen
            FROM jobs
            GROUP BY source
        ),
        latest_runs AS (
            SELECT DISTINCT ON (source)
                source, status, started_at, finished_at, jobs_found, jobs_new
            FROM crawl_runs
            ORDER BY source, started_at DESC
        )
        SELECT
            coalesce(j.source, r.source) AS source,
            coalesce(r.status, 'ok') AS status,
            coalesce(r.started_at, j.last_seen) AS started_at,
            r.finished_at AS finished_at,
            coalesce(r.jobs_found, j.total, 0) AS jobs_found,
            coalesce(r.jobs_new, 0) AS jobs_new,
            coalesce(j.total, 0) AS total
        FROM job_counts j
        FULL OUTER JOIN latest_runs r ON j.source = r.source
        """
    ).fetchall()
    return {row[0]: source_dto(row) for row in rows}


def _connected_platforms(conn: psycopg.Connection, user_id: int) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT platform, status, external_account FROM platform_connections WHERE user_id = %s",
        (user_id,),
    ).fetchall()
    return {
        platform: {"status": status, "externalAccount": external}
        for platform, status, external in rows
    }


def _has_active_runner(conn: psycopg.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM runners WHERE user_id = %s AND revoked_at IS NULL LIMIT 1",
        (user_id,),
    ).fetchone()
    return row is not None


def platform_catalogue(conn: psycopg.Connection, user_id: int, settings: Settings) -> list[dict]:
    """The full catalogue for the signed-in user: `{id, label, kind, homepage, description,
    available, connected, status?}`. `status` (crawl health) is only present for `public`
    platforms, and only when `jobs`/`crawl_runs` have a row for it."""
    statuses = _source_status_by_id(conn)
    connections = _connected_platforms(conn, user_id)
    has_runner = _has_active_runner(conn, user_id)

    items: list[dict] = []
    for meta in CATALOGUE:
        connection = connections.get(meta.id)
        available = settings.upwork_available() if meta.id == "upwork" else True

        item: dict = {
            "id": meta.id,
            "label": meta.label,
            "kind": meta.kind,
            "homepage": meta.homepage,
            "description": meta.description,
            "available": available,
            "connected": (
                has_runner
                if meta.kind == "runner"
                else connection is not None and connection["status"] == "connected"
            ),
        }
        if connection is not None:
            item["externalAccount"] = connection["externalAccount"]
        if meta.kind == "public" and meta.id in statuses:
            item["status"] = statuses[meta.id]["status"]
        items.append(item)
    return items
