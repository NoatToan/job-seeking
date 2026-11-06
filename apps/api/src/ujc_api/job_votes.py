"""Community signal on jobs: "Not worth applying?" reports and "Still good" confirmations
(migration 029, docs/DECISIONS.md "Job downvotes").

Votes live in `job_votes` (one per job and user). What everyone sees is `job_vote_stats`, one
denormalised row per job, recomputed by `refresh_stats` in the same request as every vote write
and once a day by `ujc_api.maintenance` (so decay and the account-age rule move without a vote).
Job lists and the job detail read it with one primary-key LEFT JOIN (`STATS_JOIN`), so the public
payloads stay one statement and identical for every viewer (CDN-cacheable).

What counts (all in `REFRESH_SQL`):

- Only votes from accounts at least `MIN_ACCOUNT_AGE_HOURS` old (throwaway sign-ups can't sink a
  job; they count once the account comes of age, at the next refresh).
- Weight 1 for votes from the last `FULL_WEIGHT_DAYS`, 0.5 up to `MAX_AGE_DAYS`, then nothing.
- Not votes written before an admin cleared the job (`job_vote_stats.cleared_at`).
- Not votes written before the job's `posted_at` (a repost / refresh by the board starts over),
  except `evergreen` reports, which are exactly about endless reposting.
- `flagged` (the row chip, "Hide reported jobs"): weighted reports >= `FLAG_THRESHOLD` and more
  than the weighted confirmations. One person alone never flags a job.
"""

from datetime import datetime
from typing import Any

import psycopg

REASONS = ("expired", "not_remote", "scam", "wrong_details", "ghosting", "evergreen", "other")
NOTE_MAX_LENGTH = 200

MIN_ACCOUNT_AGE_HOURS = 24
FULL_WEIGHT_DAYS = 14
MAX_AGE_DAYS = 45
FLAG_THRESHOLD = 2.0

#: Vote writes (PUT) per user per window; changing your mind a few times is fine, sweeping isn't.
RATE_LIMIT_VOTES = 30
RATE_LIMIT_WINDOW_SECONDS = 3600

#: Join for job queries; `vs` columns are read with `STATS_COLUMNS`.
STATS_JOIN = "LEFT JOIN job_vote_stats vs ON vs.job_id = jobs.id"
STATS_COLUMNS = "vs.down_count, vs.up_count, vs.flagged, vs.top_reason, vs.reasons, vs.last_down_at"
STATS_COLUMN_COUNT = 6
#: `GET /api/jobs?hide_reported=true` / feed: drop flagged jobs.
# An anti-join, not `vs.flagged IS NOT TRUE`: a filter on the LEFT JOIN's column makes the planner
# hash-join the whole catalogue (~40 ms at 50k jobs) instead of walking `jobs_feed_idx` (0.03 ms).
HIDE_REPORTED_CLAUSE = (
    "NOT EXISTS (SELECT 1 FROM job_vote_stats hr WHERE hr.job_id = jobs.id AND hr.flagged)"
)

_PARAMS = {
    "min_age_hours": MIN_ACCOUNT_AGE_HOURS,
    "full_days": FULL_WEIGHT_DAYS,
    "max_days": MAX_AGE_DAYS,
    "threshold": FLAG_THRESHOLD,
}

# One statement for any number of jobs: recompute the aggregate for `ids` and upsert it. Ids that
# are not (or no longer) in `jobs` are skipped. RETURNING gives the fresh stats back.
REFRESH_SQL = """
WITH target AS (
    SELECT j.id AS job_id, j.posted_at
    FROM jobs j
    WHERE j.id = ANY(%(ids)s::bigint[])
),
eligible AS (
    SELECT v.job_id, v.vote, v.reason, v.updated_at,
        CASE WHEN v.updated_at > now() - make_interval(days => %(full_days)s)
            THEN 1.0 ELSE 0.5 END AS w
    FROM target t
    JOIN job_votes v ON v.job_id = t.job_id
    JOIN users u ON u.id = v.user_id
    LEFT JOIN job_vote_stats s ON s.job_id = t.job_id
    WHERE v.updated_at > now() - make_interval(days => %(max_days)s)
      AND u.created_at <= now() - make_interval(hours => %(min_age_hours)s)
      AND (s.cleared_at IS NULL OR v.updated_at > s.cleared_at)
      AND (v.reason = 'evergreen' OR t.posted_at IS NULL OR v.updated_at >= t.posted_at)
),
by_reason AS (
    SELECT job_id, reason, count(*) AS n, max(updated_at) AS last_at
    FROM eligible
    WHERE vote = -1
    GROUP BY job_id, reason
),
agg AS (
    SELECT t.job_id,
        count(e.job_id) FILTER (WHERE e.vote = -1) AS down_count,
        count(e.job_id) FILTER (WHERE e.vote = 1) AS up_count,
        coalesce(sum(e.w) FILTER (WHERE e.vote = -1), 0) AS down_score,
        coalesce(sum(e.w) FILTER (WHERE e.vote = 1), 0) AS up_score,
        max(e.updated_at) FILTER (WHERE e.vote = -1) AS last_down_at
    FROM target t
    LEFT JOIN eligible e ON e.job_id = t.job_id
    GROUP BY t.job_id
)
INSERT INTO job_vote_stats AS s (
    job_id, down_count, up_count, down_score, up_score, flagged, top_reason, reasons,
    last_down_at, refreshed_at
)
SELECT a.job_id, a.down_count, a.up_count, a.down_score, a.up_score,
    a.down_score >= %(threshold)s AND a.down_score > a.up_score,
    (SELECT r.reason FROM by_reason r WHERE r.job_id = a.job_id
        ORDER BY r.n DESC, r.last_at DESC, r.reason LIMIT 1),
    coalesce(
        (SELECT jsonb_object_agg(r.reason, r.n) FROM by_reason r WHERE r.job_id = a.job_id),
        '{}'::jsonb
    ),
    a.last_down_at, now()
FROM agg a
ON CONFLICT (job_id) DO UPDATE SET
    down_count = EXCLUDED.down_count,
    up_count = EXCLUDED.up_count,
    down_score = EXCLUDED.down_score,
    up_score = EXCLUDED.up_score,
    flagged = EXCLUDED.flagged,
    top_reason = EXCLUDED.top_reason,
    reasons = EXCLUDED.reasons,
    last_down_at = EXCLUDED.last_down_at,
    refreshed_at = EXCLUDED.refreshed_at
RETURNING s.job_id, s.down_count, s.up_count, s.flagged, s.top_reason, s.reasons, s.last_down_at
"""

# Jobs whose stats can change without a vote: any vote still inside the window, or a row that
# still shows a signal (so it decays to zero).
ACTIVE_JOBS_SQL = """
SELECT job_id FROM job_votes WHERE updated_at > now() - make_interval(days => %s)
UNION
SELECT job_id FROM job_vote_stats WHERE down_count > 0 OR up_count > 0
"""


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def community_dto(stats: tuple | None) -> dict[str, Any] | None:
    """`STATS_COLUMNS` (without the job id) -> the public `community` object, or None when
    nobody's vote counts (no row, or every count is zero)."""
    if stats is None:
        return None
    down, up, flagged, top_reason, reasons, last_down_at = stats
    if not down and not up:
        return None
    return {
        "reports": int(down or 0),
        "confirms": int(up or 0),
        "flagged": bool(flagged),
        "topReason": top_reason,
        "reasons": {k: int(v) for k, v in (reasons or {}).items()},
        "lastReportedAt": _iso(last_down_at),
    }


def refresh_stats(conn: psycopg.Connection, job_ids: list[int]) -> dict[int, dict | None]:
    """Recomputes `job_vote_stats` for `job_ids` in one statement; {job id: community dto}."""
    if not job_ids:
        return {}
    rows = conn.execute(REFRESH_SQL, {**_PARAMS, "ids": job_ids}).fetchall()
    return {row[0]: community_dto(tuple(row[1:])) for row in rows}


def refresh_all(conn: psycopg.Connection) -> int:
    """Daily: recompute every job whose stats may have moved (decay, account age, reposts)."""
    ids = [r[0] for r in conn.execute(ACTIVE_JOBS_SQL, (MAX_AGE_DAYS + 1,)).fetchall()]
    return len(refresh_stats(conn, ids))
