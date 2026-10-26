import logging
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from job_crawler.models import Board, JobRecord

log = logging.getLogger(__name__)

ERROR_MAX_LEN = 2000

UPSERT_SQL = """
INSERT INTO jobs (
  source, external_id, url, apply_url, title, company, location, remote,
  employment_type, salary_text, description, tags, posted_at, raw
) VALUES (
  %(source)s, %(external_id)s, %(url)s, %(apply_url)s, %(title)s, %(company)s, %(location)s,
  %(remote)s, %(employment_type)s, %(salary_text)s, %(description)s, %(tags)s, %(posted_at)s,
  %(raw)s
)
ON CONFLICT (source, external_id) DO UPDATE SET
  url = EXCLUDED.url,
  apply_url = EXCLUDED.apply_url,
  title = EXCLUDED.title,
  company = EXCLUDED.company,
  location = EXCLUDED.location,
  remote = EXCLUDED.remote,
  employment_type = EXCLUDED.employment_type,
  salary_text = EXCLUDED.salary_text,
  description = EXCLUDED.description,
  tags = EXCLUDED.tags,
  posted_at = COALESCE(EXCLUDED.posted_at, jobs.posted_at),
  raw = EXCLUDED.raw,
  last_seen_at = now()
RETURNING (xmax = 0) AS inserted
"""


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, autocommit=True, connect_timeout=15)


def load_boards(conn: psycopg.Connection, ats: str) -> list[Board]:
    rows = conn.execute(
        "SELECT ats, slug, company_name FROM company_boards"
        " WHERE enabled AND ats = %s ORDER BY slug",
        (ats,),
    ).fetchall()
    return [Board(ats=r[0], slug=r[1], company_name=r[2]) for r in rows]


def dedupe(jobs: list[JobRecord]) -> list[JobRecord]:
    """Keep the last record per (source, external_id) so a batch never hits a row twice."""
    return list({(j.source, j.external_id): j for j in jobs}.values())


def job_params(job: JobRecord) -> dict[str, Any]:
    params = job.model_dump()
    # mode="json" turns datetimes etc. inside the raw payload into JSON-safe values
    params["raw"] = Jsonb(job.model_dump(mode="json")["raw"])
    return params


def upsert_jobs(conn: psycopg.Connection, jobs: list[JobRecord]) -> int:
    """Upsert jobs in one transaction; returns how many rows were newly inserted."""
    jobs = dedupe(jobs)
    if not jobs:
        return 0
    new = 0
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(UPSERT_SQL, [job_params(j) for j in jobs], returning=True)
        while True:
            row = cur.fetchone()
            if row and row[0]:
                new += 1
            if not cur.nextset():
                break
    return new


def start_run(conn: psycopg.Connection, source: str) -> int:
    row = conn.execute(
        "INSERT INTO crawl_runs (source, status) VALUES (%s, 'running') RETURNING id", (source,)
    ).fetchone()
    assert row is not None
    return row[0]


def finish_run(
    conn: psycopg.Connection,
    run_id: int,
    *,
    status: str,
    jobs_found: int = 0,
    jobs_new: int = 0,
    error: str | None = None,
) -> None:
    conn.execute(
        "UPDATE crawl_runs SET finished_at = now(), status = %s, jobs_found = %s,"
        " jobs_new = %s, error = %s WHERE id = %s",
        (status, jobs_found, jobs_new, truncate_error(error), run_id),
    )


def truncate_error(error: str | None) -> str | None:
    if not error:
        return None
    return error if len(error) <= ERROR_MAX_LEN else error[: ERROR_MAX_LEN - 3] + "..."


def load_search_profiles(conn: psycopg.Connection, ids: list[int] | None = None):
    """Saved search profiles (all, or only `ids`)."""
    from job_crawler.session.sites import SearchProfile

    rows = conn.execute(
        "SELECT id, name, keywords, locations, remote_only, sources FROM search_profiles"
        " WHERE %(ids)s::bigint[] IS NULL OR id = ANY(%(ids)s::bigint[]) ORDER BY id",
        {"ids": ids or None},
    ).fetchall()
    return [
        SearchProfile(
            id=r[0],
            name=r[1],
            keywords=r[2],
            locations=list(r[3] or []),
            remote_only=r[4],
            sources=list(r[5] or []),
        )
        for r in rows
    ]
