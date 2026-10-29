"""Host worker: `uv run python -m ujc_api.worker [--once] [--poll 3]`.

Polls the `tasks` table (docs/product/FLOW_V2.md §3 "Worker claim") and runs `cv_extract` tasks
through `job_crawler.matching.cv` (`claude -p`, so this only works on a machine with the Claude
Code CLI logged in — see apps/api/README.md). Needs only `DATABASE_URL`: no inbound port, no
tunnel. If it's offline, CVs simply stay `queued`.
"""

import argparse
import logging
import os
import re
import socket
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import psycopg
from job_crawler.matching.cv import CvText, extract_profile, extract_text
from psycopg.types.json import Jsonb

from ujc_api.settings import Settings, get_settings

log = logging.getLogger(__name__)

STALE_MINUTES = 15
MAX_ATTEMPTS = 3
MAX_KEYWORDS = 30
MAX_SKILLS_IN_KEYWORDS = 8
ERROR_MAX_LEN = 2000

ExtractTextFn = Callable[[Path], CvText]
ExtractProfileFn = Callable[[str], dict[str, Any]]

CLAIM_SQL = """
UPDATE tasks SET status='running', locked_by=%(worker)s, locked_at=now(), attempts=attempts+1
WHERE id = (SELECT id FROM tasks WHERE status='queued' AND run_after<=now()
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id, kind, payload, attempts
"""


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def requeue_stale(conn: psycopg.Connection) -> int:
    """Tasks stuck `running` for more than 15 minutes (a worker that died mid-task) go back to
    `queued` so another worker (or this one, next poll) picks them up."""
    cur = conn.execute(
        "UPDATE tasks SET status='queued', locked_by=NULL, locked_at=NULL"
        f" WHERE status='running' AND locked_at < now() - interval '{STALE_MINUTES} minutes'"
    )
    return cur.rowcount


def claim_task(conn: psycopg.Connection, worker: str) -> tuple[int, str, dict, int] | None:
    row = conn.execute(CLAIM_SQL, {"worker": worker}).fetchone()
    if row is None:
        return None
    task_id, kind, payload, attempts = row
    return task_id, kind, payload, attempts


def mark_task_done(conn: psycopg.Connection, task_id: int) -> None:
    conn.execute("UPDATE tasks SET status='done', error=NULL WHERE id = %s", (task_id,))


def mark_task_error(conn: psycopg.Connection, task_id: int, attempts: int, message: str) -> None:
    """Backs off (`run_after = now() + 2^attempts minutes`) until `attempts` reaches
    `MAX_ATTEMPTS`, then the task becomes `error` for good."""
    short = message[:ERROR_MAX_LEN]
    if attempts >= MAX_ATTEMPTS:
        conn.execute("UPDATE tasks SET status='error', error = %s WHERE id = %s", (short, task_id))
    else:
        backoff_minutes = 2**attempts
        conn.execute(
            "UPDATE tasks SET status='queued',"
            " run_after = now() + (%s || ' minutes')::interval, error = %s WHERE id = %s",
            (backoff_minutes, short, task_id),
        )


def _build_keywords(profile: dict[str, Any]) -> list[str]:
    """`profile.search_keywords` + the first 8 skills, lowercased, deduped, capped at 30."""
    search_keywords = [
        str(k).strip().lower() for k in profile.get("search_keywords") or [] if str(k).strip()
    ]
    skills = [
        str(s).strip().lower()
        for s in (profile.get("skills") or [])[:MAX_SKILLS_IN_KEYWORDS]
        if str(s).strip()
    ]
    return list(dict.fromkeys(search_keywords + skills))[:MAX_KEYWORDS]


_VIETNAM_RE = re.compile(r"\bviet ?nam\b|\bvn\b", re.IGNORECASE)


def _mentions_vietnam(location: str | None) -> bool:
    return bool(location and _VIETNAM_RE.search(location))


def _seed_preferences_if_empty(
    conn: psycopg.Connection, user_id: int, keywords: list[str], profile: dict[str, Any]
) -> None:
    """Seeds `user_preferences` from the CV the first time, and only then — never overwrites
    keywords a user already has (their own edits win)."""
    row = conn.execute(
        "SELECT keywords, candidate_country FROM user_preferences WHERE user_id = %s FOR UPDATE",
        (user_id,),
    ).fetchone()
    if row is not None and row[0]:
        return
    candidate_country = row[1] if row else None
    if _mentions_vietnam(profile.get("location")):
        candidate_country = "VN"
    conn.execute(
        "INSERT INTO user_preferences (user_id, keywords, candidate_country, updated_at)"
        " VALUES (%s, %s, %s, now())"
        " ON CONFLICT (user_id) DO UPDATE SET"
        "   keywords = EXCLUDED.keywords, candidate_country = EXCLUDED.candidate_country,"
        "   updated_at = now()",
        (user_id, keywords, candidate_country),
    )


def process_cv_extract(
    conn: psycopg.Connection,
    payload: dict[str, Any],
    *,
    extract_text_fn: ExtractTextFn = extract_text,
    extract_profile_fn: ExtractProfileFn = extract_profile,
) -> None:
    """`cv_extract`: text layer or OCR -> structured profile -> keywords, written back onto the
    `user_cvs` row. `extract_text_fn`/`extract_profile_fn` are injectable so tests never shell
    out to the real `claude` CLI."""
    cv_id = payload["cv_id"]
    row = conn.execute(
        "SELECT user_id, filename, content FROM user_cvs WHERE id = %s", (cv_id,)
    ).fetchone()
    if row is None:
        raise RuntimeError(f"user_cvs row {cv_id} not found")
    user_id, filename, content = row

    conn.execute("UPDATE user_cvs SET status = 'processing' WHERE id = %s", (cv_id,))

    suffix = Path(filename).suffix or ""
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(content)
        tmp.flush()
        cv_text = extract_text_fn(Path(tmp.name))

    profile = extract_profile_fn(cv_text.text)
    keywords = _build_keywords(profile)

    with conn.transaction():
        conn.execute(
            "UPDATE user_cvs SET status = 'done', text = %s, profile = %s, keywords = %s,"
            " processed_at = now(), error = NULL WHERE id = %s",
            (cv_text.text, Jsonb(profile), keywords, cv_id),
        )
        _seed_preferences_if_empty(conn, user_id, keywords, profile)


def _update_cv_after_failure(
    conn: psycopg.Connection, payload: dict[str, Any], attempts: int, message: str
) -> None:
    cv_id = payload.get("cv_id")
    if cv_id is None:
        return
    short = message[:ERROR_MAX_LEN]
    status = "error" if attempts >= MAX_ATTEMPTS else "queued"
    conn.execute(
        "UPDATE user_cvs SET status = %s, error = %s WHERE id = %s", (status, short, cv_id)
    )


def run_once(
    conn: psycopg.Connection,
    *,
    worker: str,
    extract_text_fn: ExtractTextFn = extract_text,
    extract_profile_fn: ExtractProfileFn = extract_profile,
) -> bool:
    """Requeues stale tasks, claims at most one, and processes it. Returns whether a task was
    claimed (False means the queue was empty, i.e. the caller should sleep before polling again).
    """
    requeue_stale(conn)
    claimed = claim_task(conn, worker)
    if claimed is None:
        return False

    task_id, kind, payload, attempts = claimed
    try:
        if kind == "cv_extract":
            process_cv_extract(
                conn,
                payload,
                extract_text_fn=extract_text_fn,
                extract_profile_fn=extract_profile_fn,
            )
        else:
            raise ValueError(f"unknown task kind: {kind!r}")
    except Exception as exc:  # noqa: BLE001 - this is the top-level per-task error boundary
        log.warning("task %s (%s) failed (attempt %s): %s", task_id, kind, attempts, exc)
        with conn.transaction():
            mark_task_error(conn, task_id, attempts, str(exc))
            if kind == "cv_extract":
                _update_cv_after_failure(conn, payload, attempts, str(exc))
    else:
        mark_task_done(conn, task_id)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="ujc_api host worker (cv_extract)")
    parser.add_argument("--once", action="store_true", help="process at most one task, then exit")
    parser.add_argument(
        "--poll", type=float, default=3.0, help="seconds to sleep between polls when idle"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings: Settings = get_settings()
    me = worker_id()
    log.info("ujc_api worker %s starting", me)

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        while True:
            processed = run_once(conn, worker=me)
            if args.once:
                break
            if not processed:
                time.sleep(args.poll)


if __name__ == "__main__":
    main()
