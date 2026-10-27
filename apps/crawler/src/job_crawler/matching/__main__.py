"""uv run python -m job_crawler.matching --profile ID --cv path/to/cv.pdf [--limit 30]

Reads the CV, extracts a profile with Claude, takes the jobs this search profile matches (same
rules as its web page), prefilters them by keywords and asks Claude to score the best ones.
Results go to `cvs` / `cv_matches` and show on the profile page.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from psycopg.types.json import Jsonb

from job_crawler import db, eligibility
from job_crawler.cli import REPO_ROOT
from job_crawler.matching import cv, prefilter, scorer
from job_crawler.matching.claude import ClaudeError

log = logging.getLogger("job_crawler.matching")
BATCH = 8


def load_jobs(conn, profile, limit: int = 2000) -> list[scorer.StoredJob]:
    """Jobs the profile page would show: linked by a site search, or full-text matches."""
    accepted = None
    if profile.candidate_country:
        accepted = [
            eligibility.WORLDWIDE,
            profile.candidate_country,
            *eligibility.COUNTRY_REGIONS.get(profile.candidate_country, []),
        ]
    rows = conn.execute(
        """
        SELECT id, title, company, location, remote, open_to, salary_text, employment_type,
               tags, coalesce(description, '')
        FROM jobs
        WHERE (id IN (SELECT job_id FROM profile_jobs WHERE profile_id = %(pid)s)
               OR (search @@ websearch_to_tsquery('english', %(q)s)
                   AND (NOT %(remote_only)s OR remote)
                   AND (cardinality(%(sources)s::text[]) = 0 OR source = ANY(%(sources)s))))
          AND (%(accepted)s::text[] IS NULL OR NOT remote OR open_to IS NULL
               OR open_to && %(accepted)s::text[])
        ORDER BY coalesce(posted_at, first_seen_at) DESC
        LIMIT %(limit)s
        """,
        {
            "pid": profile.id,
            "q": profile.keywords,
            "remote_only": profile.remote_only,
            "sources": profile.sources,
            "accepted": accepted,
            "limit": limit,
        },
    ).fetchall()
    return [scorer.StoredJob(*r) for r in rows]


def save_cv(conn, profile_id: int, path: Path, text: cv.CvText, extracted: dict) -> int:
    row = conn.execute(
        "INSERT INTO cvs (profile_id, filename, text, extracted, ocr_used)"
        " VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (profile_id, path.name, text.text, Jsonb(extracted), text.ocr_used),
    ).fetchone()
    return row[0]


def save_matches(conn, cv_id: int, results: list[scorer.MatchResult]) -> None:
    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO cv_matches (cv_id, job_id, score, summary, reasons, missing_skills)"
            " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (cv_id, job_id) DO UPDATE SET"
            " score = EXCLUDED.score, summary = EXCLUDED.summary, reasons = EXCLUDED.reasons,"
            " missing_skills = EXCLUDED.missing_skills, created_at = now()",
            [(cv_id, r.job_id, r.score, r.summary, r.reasons, r.missing_skills) for r in results],
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="job_crawler.matching",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--profile", type=int, required=True, help="search profile id")
    parser.add_argument("--cv", type=Path, required=True, help="PDF, image, TXT or MD")
    parser.add_argument("--limit", type=int, default=24, help="jobs to send to Claude (max 60)")
    parser.add_argument("--preferences", default="", help='e.g. "remote or relocation, no US-only"')
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    if not os.environ.get("DATABASE_URL"):
        log.error("DATABASE_URL is not set")
        return 2
    if not args.cv.is_file():
        log.error("CV file not found: %s", args.cv)
        return 2

    conn = db.connect(os.environ["DATABASE_URL"])
    try:
        (profile,) = db.load_search_profiles(conn, [args.profile]) or [None]
        if profile is None:
            log.error("search profile %d not found", args.profile)
            return 2
        text = cv.extract_text(args.cv)
        log.info("CV text: %d chars (ocr=%s)", len(text.text), text.ocr_used)
        extracted = cv.extract_profile(text.text)
        log.info(
            "CV profile: %s",
            json.dumps(
                {k: extracted.get(k) for k in ("headline", "seniority", "skills")},
                ensure_ascii=False,
            )[:300],
        )
        cv_id = save_cv(conn, profile.id, args.cv, text, extracted)

        jobs = load_jobs(conn, profile)
        picked = prefilter.top_candidates(extracted, jobs, limit=max(1, min(args.limit, 60)))
        log.info("%d jobs for the profile, %d sent to Claude", len(jobs), len(picked))
        results: list[scorer.MatchResult] = []
        batch_jobs = [j for j, _ in picked]
        for i in range(0, len(batch_jobs), BATCH):
            try:
                results += scorer.score_jobs(extracted, args.preferences, batch_jobs[i : i + BATCH])
            except ClaudeError as exc:
                log.warning("batch %d failed: %s", i // BATCH + 1, exc)
        save_matches(conn, cv_id, results)
        best = sorted(results, key=lambda r: r.score, reverse=True)[:10]
        titles = {j.id: f"{j.title} · {j.company}" for j in batch_jobs}
        for r in best:
            print(f"{r.score:>3}  {titles[r.job_id]}  — {r.summary}")
        return 0 if results or not picked else 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
