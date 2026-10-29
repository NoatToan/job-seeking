"""Upserts live-search results into `jobs` and returns their ids, keyed by `(source, external_id)`.

`job_crawler.db.upsert_jobs` only returns a count of newly-inserted rows (the daily crawl never
needs the ids back); `/api/search/live` does, to build `Job` DTOs with real DB ids. This reuses
`upsert_jobs` for the actual write (so eligibility/`open_to` derivation stays in one place) and
then joins back by `(source, external_id)`, the same pattern `job_crawler.db.link_profile_jobs`
uses.
"""

import psycopg
from job_crawler import db as crawler_db
from job_crawler.models import JobRecord


def upsert_jobs_get_ids(
    conn: psycopg.Connection, jobs: list[JobRecord]
) -> dict[tuple[str, str], int]:
    jobs = crawler_db.dedupe(jobs)
    if not jobs:
        return {}
    crawler_db.upsert_jobs(conn, jobs)
    sources = [j.source for j in jobs]
    external_ids = [j.external_id for j in jobs]
    rows = conn.execute(
        "SELECT jobs.id, jobs.source, jobs.external_id FROM jobs"
        " JOIN unnest(%s::text[], %s::text[]) AS k(source, external_id)"
        "   ON jobs.source = k.source AND jobs.external_id = k.external_id",
        (sources, external_ids),
    ).fetchall()
    return {(r[1], r[2]): r[0] for r in rows}
