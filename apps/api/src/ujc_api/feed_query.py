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
