"""Daily digest email (M4-08, flow v2 adaptation).

Run hourly: `uv run python -m ujc_api.digest run [--dry-run] [--user EMAIL]`
(`.github/workflows/digest.yml`, or launchd/cron — see apps/api/README.md). `digest_hour` is a
user-local hour (0-23, interpreted in `digest_tz`), so running this every hour and checking "has
the user's local digest hour already passed today, and did they not already get one today" is
enough for "once a day around a preferred local hour" without per-minute scheduling.

Unsubscribe is stateless: HMAC(UJC_SECRET_KEY, user_id|"digest") (`unsubscribe_token` /
`verify_unsubscribe_token`), so there is no token table to manage and no expiry — anyone who
guesses another user's numeric id still can't forge their token without the secret key.
"""

import argparse
import hashlib
import hmac
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg

from ujc_api.dto import JOB_COLUMNS, job_dto
from ujc_api.feed_query import feed_filter_clauses
from ujc_api.mail import MailDeliveryFailed, deliver_digest
from ujc_api.settings import Settings, get_settings

log = logging.getLogger(__name__)

MAX_JOBS = 10
# A user's very first digest only looks back this far (instead of "since account creation",
# which could otherwise mean mailing someone every job from months ago the first time they're
# due).
FIRST_DIGEST_LOOKBACK = timedelta(hours=24)


def unsubscribe_token(settings: Settings, user_id: int) -> str:
    """HMAC(UJC_SECRET_KEY, "<user_id>|digest"). Deterministic, so it never needs to be stored."""
    message = f"{user_id}|digest".encode()
    return hmac.new(settings.ujc_secret_key.encode(), message, hashlib.sha256).hexdigest()


def verify_unsubscribe_token(settings: Settings, user_id: int, token: str) -> bool:
    expected = unsubscribe_token(settings, user_id)
    return hmac.compare_digest(expected, token)


@dataclass
class DueUser:
    id: int
    email: str
    tz: str
    last_digest_at: datetime | None


def due_users(
    conn: psycopg.Connection, now_utc: datetime, *, only_email: str | None = None
) -> list[DueUser]:
    """Every user with `digest_enabled` whose local digest hour has passed `now_utc` today and
    who hasn't already received one today (in their own local calendar day)."""
    sql = (
        "SELECT u.id, u.email, up.digest_tz, up.digest_hour, up.last_digest_at"
        " FROM users u JOIN user_preferences up ON up.user_id = u.id"
        " WHERE up.digest_enabled = true"
    )
    params: tuple[Any, ...] = ()
    if only_email:
        sql += " AND u.email = %s"
        params = (only_email,)
    rows = conn.execute(sql, params).fetchall()

    due: list[DueUser] = []
    for user_id, email, tz_name, hour, last_digest_at in rows:
        try:
            tz = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            log.warning("digest: unknown digest_tz %r for user %s; skipping", tz_name, user_id)
            continue
        local_now = now_utc.astimezone(tz)
        if local_now.hour < hour:
            continue
        if last_digest_at is not None and last_digest_at.astimezone(tz).date() >= local_now.date():
            continue
        due.append(DueUser(id=user_id, email=email, tz=tz_name, last_digest_at=last_digest_at))
    return due


def select_digest_jobs(
    conn: psycopg.Connection, user_id: int, since: datetime
) -> list[dict[str, Any]]:
    """New jobs since `since` matching this user's feed filters (same keyword/remote/eligibility
    rules as `GET /api/feed` — see `ujc_api.feed_query`), ranked by match score when the user has
    one, newest first otherwise, capped at `MAX_JOBS`. Upwork is always excluded (never polled,
    never scored, never digested — see docs/product/ARCHITECTURE.md D6).
    """
    prefs_row = conn.execute(
        "SELECT keywords, remote_only, candidate_country FROM user_preferences WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    keywords: list[str] = list(prefs_row[0]) if prefs_row else []
    remote_only: bool = bool(prefs_row[1]) if prefs_row else False
    candidate_country: str | None = prefs_row[2] if prefs_row else None

    clauses, params = feed_filter_clauses(keywords, remote_only, candidate_country)
    clauses.append("source != 'upwork'")
    clauses.append("first_seen_at > %s")
    params.append(since)

    where = " AND ".join(clauses)
    sql = (
        f"SELECT {JOB_COLUMNS}, um.score, um.summary, um.missing_skills FROM jobs"
        " LEFT JOIN user_matches um ON um.user_id = %s AND um.job_id = jobs.id"
        f" WHERE {where}"
        " ORDER BY um.score DESC NULLS LAST, coalesce(posted_at, first_seen_at) DESC, jobs.id DESC"
        " LIMIT %s"
    )
    rows = conn.execute(sql, [user_id, *params, MAX_JOBS]).fetchall()

    jobs: list[dict[str, Any]] = []
    for row in rows:
        *job_row, score, _summary, _missing_skills = row
        dto = job_dto(tuple(job_row))
        dto["score"] = score
        jobs.append(dto)
    return jobs


def run_digest(
    conn: psycopg.Connection,
    settings: Settings,
    *,
    dry_run: bool = False,
    only_email: str | None = None,
    now: datetime | None = None,
) -> dict[str, int]:
    """Sends (or, in `--dry-run`, previews) the digest to every due user. Returns a count per
    outcome: `sent` (delivered via Resend), `logged_only` (no `RESEND_API_KEY`; "would send" was
    logged instead), `skipped_empty` (no new matching jobs) and `dry_run`.

    `last_digest_at` is advanced for every outcome except `dry_run`, including `skipped_empty` —
    that's what "once a day" means here, not "once a day with content"; it also keeps tomorrow's
    `since` window from growing unbounded for a quiet user.
    """
    now = now or datetime.now(UTC)
    counts = {"sent": 0, "logged_only": 0, "skipped_empty": 0, "dry_run": 0, "failed": 0}

    for user in due_users(conn, now, only_email=only_email):
        since = user.last_digest_at or (now - FIRST_DIGEST_LOOKBACK)
        jobs = select_digest_jobs(conn, user.id, since)

        if not jobs:
            counts["skipped_empty"] += 1
            log.info("digest: skipped_empty user_id=%s", user.id)
            if not dry_run:
                conn.execute(
                    "UPDATE user_preferences SET last_digest_at = %s WHERE user_id = %s",
                    (now, user.id),
                )
            continue

        if dry_run:
            counts["dry_run"] += 1
            log.info("digest: dry-run would send %d job(s) to user_id=%s", len(jobs), user.id)
            continue

        token = unsubscribe_token(settings, user.id)
        unsubscribe_url = f"{settings.ujc_public_url}/api/digest/unsubscribe?u={user.id}&t={token}"
        try:
            sent = deliver_digest(
                settings,
                user.email,
                jobs,
                unsubscribe_url=unsubscribe_url,
                app_url=settings.ujc_public_url,
            )
        except MailDeliveryFailed as exc:
            # One user's delivery failure (e.g. Resend hiccup) shouldn't stop the rest of the
            # run; `last_digest_at` is deliberately *not* advanced, so they're retried next hour.
            counts["failed"] += 1
            log.warning("digest: failed user_id=%s: %s", user.id, exc)
            continue

        conn.execute(
            "UPDATE user_preferences SET last_digest_at = %s WHERE user_id = %s", (now, user.id)
        )
        outcome = "sent" if sent else "logged_only"
        counts[outcome] += 1
        log.info("digest: %s user_id=%s jobs=%d", outcome, user.id, len(jobs))

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m ujc_api.digest")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="send the daily digest to every due user")
    run_p.add_argument(
        "--dry-run", action="store_true", help="log what would be sent without sending or saving"
    )
    run_p.add_argument(
        "--user",
        metavar="EMAIL",
        help="only consider this user (still subject to their digest hour)",
    )

    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        counts = run_digest(conn, settings, dry_run=args.dry_run, only_email=args.user)

    print(f"digest: {counts}")


if __name__ == "__main__":
    main()
