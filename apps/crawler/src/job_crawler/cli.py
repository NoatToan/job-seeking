import argparse
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from job_crawler import db, profile_search
from job_crawler.http import HttpClient
from job_crawler.models import Board
from job_crawler.sources import ATS_SOURCES, DEFAULT_BOARDS, SOURCES, SkipSource

log = logging.getLogger("job_crawler")

REPO_ROOT = Path(__file__).resolve().parents[4]


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="job_crawler", description="Crawl job sources into Postgres"
    )
    parser.add_argument(
        "--source", action="append", choices=sorted(SOURCES), help="only these sources (repeatable)"
    )
    parser.add_argument("--dry-run", action="store_true", help="fetch and count, no DB writes")
    parser.add_argument(
        "--profiles",
        action="store_true",
        help="also search each saved search profile's keywords on Himalayas / Remotive",
    )
    parser.add_argument(
        "--recompute-open-to",
        action="store_true",
        help="re-derive who may apply (open_to) for all stored jobs, then exit",
    )
    parser.add_argument(
        "--recompute-derived",
        "--recompute-timezones",
        dest="recompute_derived",
        action="store_true",
        help="re-derive open_to, time zones, countries, … (job_crawler.derived) for all stored"
        " jobs, then exit",
    )
    parser.add_argument(
        "--normalize-descriptions",
        action="store_true",
        help="tidy whitespace / bullets in every stored description (text.normalize_description),"
        " then exit",
    )
    parser.add_argument(
        "--backfill-sections",
        action="store_true",
        help="re-parse description sections and level (sections.py, level.py) on jobs parsed by"
        " older rules (sections_version below sections.VERSION), in batches, then exit."
        " Idempotent and resumable; --recompute-derived runs it too",
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=db.BACKFILL_BATCH,
        help=f"rows per committed batch for --backfill-sections (default {db.BACKFILL_BATCH})",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    sources = args.source or list(SOURCES)

    conn = None
    if not args.dry_run:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            log.error("DATABASE_URL is not set (use --dry-run to crawl without a database)")
            return 2
        conn = db.connect(database_url)
        if args.recompute_open_to:
            log.info("open_to updated on %d jobs", db.recompute_open_to(conn))
            conn.close()
            return 0
        if args.normalize_descriptions:
            log.info("descriptions normalised on %d jobs", db.normalize_descriptions(conn))
            conn.close()
            return 0
        if args.backfill_sections:
            log.info("sections re-parsed on %d jobs", db.backfill_sections(conn, batch=args.batch))
            conn.close()
            return 0
        if args.recompute_derived:
            log.info("derived columns updated on %d jobs", db.recompute_derived(conn))
            # The nightly recompute (daily-crawl.yml, or a host-side schedule) also brings
            # sections / level up to the current rules version: a no-op once every row is on it.
            log.info("sections re-parsed on %d jobs", db.backfill_sections(conn, batch=args.batch))
            conn.close()
            return 0

    failed = 0
    with HttpClient() as http:
        for source in sources:
            failed += not run_source(source, http, conn)
        if args.profiles:
            failed += run_profile_search(http, conn, args.dry_run)
    if conn is not None:
        conn.close()
    return 1 if failed else 0


def run_profile_search(http: HttpClient, conn, dry_run: bool) -> int:
    if conn is None:
        log.info("profile search needs the database (search profiles live there): skipped")
        return 0
    return profile_search.run(conn, http, db.load_search_profiles(conn), dry_run=dry_run)


def boards_for(source: str, conn) -> list[Board]:
    if source not in ATS_SOURCES:
        return []
    return db.load_boards(conn, source) if conn is not None else DEFAULT_BOARDS.get(source, [])


def run_source(source: str, http: HttpClient, conn) -> bool:
    """Crawl one source. Returns False only when the source failed outright."""
    run_id = db.start_run(conn, source) if conn is not None else None
    try:
        result = SOURCES[source](http, boards_for(source, conn))
    except SkipSource as exc:
        log.info("%s: skipped (%s)", source, exc)
        if run_id is not None:
            db.finish_run(conn, run_id, status="ok", error=f"skipped: {exc}")
        return True
    except Exception as exc:  # noqa: BLE001 - one source must not stop the others
        log.error("%s: failed: %s: %s", source, type(exc).__name__, exc)
        if run_id is not None:
            db.finish_run(conn, run_id, status="error", error=f"{type(exc).__name__}: {exc}")
        return False

    found = len(db.dedupe(result.jobs))
    errors = "; ".join(result.errors) or None
    if run_id is None:
        print(f"{source}: {found} jobs" + (f" ({len(result.errors)} errors)" if errors else ""))
        return True
    new = db.upsert_jobs(conn, result.jobs)
    db.finish_run(conn, run_id, status="ok", jobs_found=found, jobs_new=new, error=errors)
    log.info("%s: %d jobs, %d new", source, found, new)
    return True
