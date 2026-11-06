"""`uv run python -m ujc_api.maintenance purge`: CV retention + expired-row cleanup (M5-04).

Run on a schedule (e.g. a daily cron/systemd timer on the host next to the worker). Needs only
`DATABASE_URL`.

- CV retention: `user_cvs` rows older than `CV_RETENTION_DAYS` (180) have their file `content` and
  extracted `text` cleared. The structured `profile`/`keywords` are kept (so matching keeps
  working) — only the original bytes and raw text are deleted.
- Expired `sessions` (past `expires_at`) are deleted.
- Expired/consumed-long-ago `email_otps` are deleted (past `expires_at`).

`refresh-votes` (also part of `purge`): recompute `job_vote_stats` so report decay, accounts that
came of age and reposts reach jobs nobody voted on today (ujc_api.job_votes). Run daily after the
crawl (.github/workflows/daily-crawl.yml).
"""

import argparse
import logging

import psycopg

from ujc_api.job_votes import refresh_all as refresh_job_vote_stats
from ujc_api.settings import get_settings

log = logging.getLogger(__name__)

CV_RETENTION_DAYS = 180


def purge_old_cv_content(conn: psycopg.Connection) -> int:
    """Clears `content`/`text` on `user_cvs` rows created more than `CV_RETENTION_DAYS` ago.
    Keeps `profile`/`keywords`/`filename`/`status` so matching keeps working."""
    cur = conn.execute(
        "UPDATE user_cvs SET content = ''::bytea, text = NULL"
        f" WHERE created_at < now() - interval '{CV_RETENTION_DAYS} days'"
        " AND (length(content) > 0 OR text IS NOT NULL)"
    )
    return cur.rowcount


def purge_expired_sessions(conn: psycopg.Connection) -> int:
    cur = conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    return cur.rowcount


def purge_expired_otps(conn: psycopg.Connection) -> int:
    cur = conn.execute("DELETE FROM email_otps WHERE expires_at < now()")
    return cur.rowcount


def purge_expired_upwork_cache(conn: psycopg.Connection) -> int:
    """Upwork API & MCP Terms §8.3: cached search results live at most 24h, never refreshed in
    place — this just deletes rows past their `expires_at` (M3-04)."""
    cur = conn.execute("DELETE FROM upwork_search_cache WHERE expires_at < now()")
    return cur.rowcount


def purge(conn: psycopg.Connection) -> dict[str, int]:
    with conn.transaction():
        result = {
            "cvs_content_cleared": purge_old_cv_content(conn),
            "sessions_deleted": purge_expired_sessions(conn),
            "otps_deleted": purge_expired_otps(conn),
            "upwork_cache_deleted": purge_expired_upwork_cache(conn),
            "job_vote_stats_refreshed": refresh_job_vote_stats(conn),
        }
    log.info("purge: %s", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="ujc_api data retention / cleanup")
    parser.add_argument("command", choices=["purge", "refresh-votes"])
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    with psycopg.connect(settings.database_url) as conn:
        if args.command == "purge":
            purge(conn)
        elif args.command == "refresh-votes":
            log.info("job_vote_stats refreshed: %s", refresh_job_vote_stats(conn))


if __name__ == "__main__":
    main()
