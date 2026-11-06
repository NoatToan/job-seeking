"""The keyword/remote/eligibility filter shared by `GET /api/feed` (routers/feed.py) and the
daily digest (ujc_api.digest), so a digest only ever contains jobs the user would also see in
their feed. See docs/product/FLOW_V2.md §3 "Filters".
"""

from typing import Any

from job_crawler import eligibility

# "Jobs in / open to this country" (ISO code param), on `jobs.countries` (migration 017).
COUNTRY_CLAUSE = "countries @> ARRAY[%s]::text[]"
# "Jobs that mention all of these technologies" (list param), on `jobs.tech_stack` (migration 018).
TECH_CLAUSE = "tech_stack @> %s::text[]"


# "Posted within N days": the date the board gave, else when we first saw the job.
POSTED_WITHIN_CLAUSE = "coalesce(posted_at, first_seen_at) >= now() - make_interval(days => %s)"
MAX_POSTED_WITHIN_DAYS = 365
# "Posted within N hours" ("1 hour ago", "today" = hours since the visitor's local midnight).
# Takes precedence over `days`. Boards that only give a date store midnight, so for those jobs
# the hour filters effectively fall back to the day they were posted / first seen.
POSTED_WITHIN_HOURS_CLAUSE = (
    "coalesce(posted_at, first_seen_at) >= now() - make_interval(hours => %s)"
)
MAX_POSTED_WITHIN_HOURS = 24 * 7


def posted_within_clause(days: int | None, hours: int | None) -> tuple[str, int] | None:
    """The "posted within" filter for `hours` (wins) or `days`, clamped; None when neither."""
    if hours:
        return POSTED_WITHIN_HOURS_CLAUSE, max(1, min(hours, MAX_POSTED_WITHIN_HOURS))
    if days:
        return POSTED_WITHIN_CLAUSE, max(1, min(days, MAX_POSTED_WITHIN_DAYS))
    return None


def parse_tech(tech: str | None) -> list[str]:
    """ "react, nextjs" -> ["react", "nextjs"] (lowercased, de-duplicated, at most 10)."""
    ids = [t.strip().lower() for t in (tech or "").split(",") if t.strip()]
    return list(dict.fromkeys(ids))[:10]


def accepted_open_to_tokens(candidate_country: str | None) -> list[str]:
    """Open-to tokens that make a remote job eligible for this candidate (or just WORLDWIDE when
    they haven't set a country)."""
    if not candidate_country:
        return [eligibility.WORLDWIDE]
    regions = eligibility.COUNTRY_REGIONS.get(candidate_country, [])
    return [eligibility.WORLDWIDE, candidate_country, *regions]


# "Remote region" filter (`access` param, with `based_in` = the candidate's ISO country):
#   open      -> hide remote jobs known NOT to accept them (keeps on-site and "region not stated")
#   confirmed -> only remote jobs whose region is stated and includes them (or worldwide)
ACCESS_MODES = ("open", "confirmed")


def access_clause(access: str | None, based_in: str | None) -> tuple[str, list[str]] | None:
    """The `WHERE` clause + param for the remote-region filter, or None when it doesn't apply."""
    if access not in ACCESS_MODES:
        return None
    tokens = accepted_open_to_tokens((based_in or "").upper() or None)
    if access == "confirmed":
        return "(remote AND open_to && %s)", tokens
    return "(NOT remote OR open_to IS NULL OR open_to && %s)", tokens


def feed_filter_clauses(
    keywords: list[str], remote_only: bool, candidate_country: str | None
) -> tuple[list[str], list[Any]]:
    """The `WHERE` clauses (and their params, in order) for "jobs matching this user's feed
    preferences": any keyword (full-text `OR`), remote-only, and remote eligibility. Callers
    append their own extra clauses (cursor, `q`, `source`, "since", ...) after these.
    """
    clauses: list[str] = []
    params: list[Any] = []

    if keywords:
        tsquery = " || ".join(["websearch_to_tsquery('english', %s)"] * len(keywords))
        clauses.append(f"search @@ ({tsquery})")
        params.extend(keywords)

    if remote_only:
        clauses.append("remote = true")

    clauses.append("(NOT remote OR open_to IS NULL OR open_to && %s)")
    params.append(accepted_open_to_tokens(candidate_country))

    return clauses, params
