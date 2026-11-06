import logging
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from job_crawler import eligibility
from job_crawler import sections as jd_sections
from job_crawler.derived import DERIVED_COLUMNS, PARSED_COLUMNS, derive, parse_posting
from job_crawler.models import Board, JobRecord
from job_crawler.text import normalize_description

log = logging.getLogger(__name__)

ERROR_MAX_LEN = 2000

_WRITTEN = (*DERIVED_COLUMNS, *PARSED_COLUMNS)
_DERIVED_INSERT = ", ".join(_WRITTEN)
_DERIVED_VALUES = ", ".join(f"%({c})s" for c in _WRITTEN)
_DERIVED_UPDATE = "".join(f"  {c} = EXCLUDED.{c},\n" for c in _WRITTEN)

UPSERT_SQL = f"""
INSERT INTO jobs (
  source, external_id, url, apply_url, title, company, location, remote,
  employment_type, salary_text, description, tags, posted_at, raw, {_DERIVED_INSERT}
) VALUES (
  %(source)s, %(external_id)s, %(url)s, %(apply_url)s, %(title)s, %(company)s, %(location)s,
  %(remote)s, %(employment_type)s, %(salary_text)s, %(description)s, %(tags)s, %(posted_at)s,
  %(raw)s, {_DERIVED_VALUES}
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
{_DERIVED_UPDATE}  last_seen_at = now()
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
    params["description"] = normalize_description(job.description)
    # mode="json" turns datetimes etc. inside the raw payload into JSON-safe values
    params["raw"] = Jsonb(job.model_dump(mode="json")["raw"])
    params.update(
        derive(
            title=job.title,
            location=job.location,
            description=params["description"],
            remote=job.remote,
            raw=job.raw,
            tags=job.tags,
            salary_text=job.salary_text,
        )
    )
    params.update(parse_posting(title=job.title, description=params["description"], raw=job.raw))
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
        "SELECT id, name, keywords, locations, remote_only, sources, candidate_country"
        " FROM search_profiles"
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
            candidate_country=r[6],
        )
        for r in rows
    ]


def link_profile_jobs(conn: psycopg.Connection, profile_id: int, jobs: list[JobRecord]) -> None:
    """Remember that a site's search for this profile returned these (already upserted) jobs."""
    keys = [(j.source, j.external_id) for j in dedupe(jobs)]
    if not keys:
        return
    conn.execute(
        "INSERT INTO profile_jobs (profile_id, job_id)"
        " SELECT %s, j.id FROM jobs j"
        " JOIN unnest(%s::text[], %s::text[]) AS k(source, external_id)"
        "   ON j.source = k.source AND j.external_id = k.external_id"
        " ON CONFLICT DO NOTHING",
        (profile_id, [k[0] for k in keys], [k[1] for k in keys]),
    )


def recompute_open_to(conn: psycopg.Connection) -> int:
    """Re-derive open_to for every stored job (after rule changes). Returns rows changed."""
    rows = conn.execute(
        "SELECT id, location, remote, raw->'locationRestrictions', raw->'requiredCountries',"
        " open_to FROM jobs"
    ).fetchall()
    changed = []
    for job_id, location, remote, restrictions, required, current in rows:
        extra = [str(v) for v in (restrictions or required or []) if v]
        tokens = eligibility.open_to(location, remote, extra)
        if tokens != current:
            changed.append((tokens, job_id))
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany("UPDATE jobs SET open_to = %s WHERE id = %s", changed)
    return len(changed)


def normalize_descriptions(conn: psycopg.Connection) -> int:
    """Re-apply `text.normalize_description` to every stored description (backfill after a rule
    change). Returns rows changed. Streams like `recompute_derived`."""
    changed: list[tuple[str | None, int]] = []
    with conn.transaction(), conn.cursor(name="description_normalize") as cur:
        cur.execute("SELECT id, description FROM jobs WHERE description IS NOT NULL")
        for job_id, description in cur:
            fresh = normalize_description(description)
            if fresh != description:
                changed.append((fresh, job_id))
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany("UPDATE jobs SET description = %s WHERE id = %s", changed)
    return len(changed)


def recompute_derived(conn: psycopg.Connection) -> int:
    """Re-derive every `DERIVED_COLUMNS` value for all stored jobs (backfill / after rule
    changes). Returns rows changed. Streams with a server-side cursor: descriptions and raw
    payloads make the whole table too big to hold at once."""
    cols = ", ".join(DERIVED_COLUMNS)
    changed: list[tuple] = []
    # A server-side (named) cursor needs a transaction even on an autocommit connection.
    with conn.transaction(), conn.cursor(name="derived_recompute") as cur:
        cur.execute(
            f"SELECT id, title, location, description, remote, raw, tags, salary_text, {cols}"
            " FROM jobs"
        )
        for job_id, title, location, description, remote, raw, tags, salary_text, *current in cur:
            fresh = derive(
                title=title,
                location=location,
                description=description,
                remote=remote,
                raw=raw,
                tags=list(tags or []),
                salary_text=salary_text,
            )
            values = [fresh[c] for c in DERIVED_COLUMNS]
            # NUMERIC columns come back as Decimal; compare as floats.
            current = [float(v) if isinstance(v, Decimal) else v for v in current]
            if values != current:
                changed.append((*values, job_id))
    sets = ", ".join(f"{c} = %s" for c in DERIVED_COLUMNS)
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(f"UPDATE jobs SET {sets} WHERE id = %s", changed)
    return len(changed)


BACKFILL_BATCH = 500


def backfill_sections(
    conn: psycopg.Connection, *, batch: int = BACKFILL_BATCH, version: int | None = None
) -> int:
    """Re-parse description sections and level (`derived.parse_posting`) on every job whose
    `sections_version` is below the current rules version (`sections.VERSION`). Works in batches
    of `batch` rows, each committed on its own: idempotent (re-parsed rows carry the new version
    and are skipped next time) and resumable (a crash or timeout loses at most one batch).
    `FOR UPDATE SKIP LOCKED` lets two overlapping runs share the work. Returns rows updated."""
    target = jd_sections.VERSION if version is None else version
    total = 0
    while True:
        with conn.transaction():
            rows = conn.execute(
                "SELECT id, title, description, raw FROM jobs WHERE sections_version < %s"
                " ORDER BY sections_version, id LIMIT %s FOR UPDATE SKIP LOCKED",
                (target, max(1, batch)),
            ).fetchall()
            if not rows:
                break
            updates = []
            for job_id, title, description, raw in rows:
                parsed = parse_posting(title=title, description=description, raw=raw)
                parsed["sections_version"] = target
                updates.append((*(parsed[c] for c in PARSED_COLUMNS), job_id))
            with conn.cursor() as cur:
                cur.executemany(
                    "UPDATE jobs SET sections = %s, sections_version = %s, level = %s,"
                    " level_source = %s WHERE id = %s",
                    updates,
                )
        total += len(rows)
        log.info("sections backfill: %d jobs re-parsed so far", total)
    return total
