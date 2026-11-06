"""In-memory fakes for unit tests that exercise real business logic (ujc_api.auth.otp,
ujc_api.worker) without a real Postgres connection — same spirit as test_migrate.py's
FakeConnection. Not a test module itself (no `test_` prefix), just shared fixtures.
"""

from datetime import UTC, datetime


class _Result:
    def __init__(self, row=None, rows=None):
        self._row = row
        self._rows = rows if rows is not None else ([] if row is None else [row])
        self.rowcount = len(self._rows)

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


class FakeOtpConn:
    """Enough of `psycopg.Connection` for `ujc_api.auth.otp`, backed by a Python list instead of
    the real `email_otps` table. `now` is injectable so expiry/rate-limit tests can move time
    forward without sleeping."""

    def __init__(self, now=lambda: datetime.now(UTC)):
        self.rows: list[dict] = []
        self._next_id = 1
        self.now = now

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        params = params or ()

        if s.startswith("SELECT count(*) FILTER"):
            email = params[0]
            last_minute = last_hour = 0
            for r in self.rows:
                if r["email"] != email:
                    continue
                age = (self.now() - r["created_at"]).total_seconds()
                if age <= 60:
                    last_minute += 1
                if age <= 3600:
                    last_hour += 1
            return _Result((last_minute, last_hour))

        if s.startswith("INSERT INTO email_otps"):
            email, code_hash, expires_at = params
            row = {
                "id": self._next_id,
                "email": email,
                "code_hash": code_hash,
                "expires_at": expires_at,
                "attempts": 0,
                "consumed_at": None,
                "created_at": self.now(),
            }
            self.rows.append(row)
            self._next_id += 1
            return _Result(None)

        if s.startswith("SELECT id, code_hash, expires_at, attempts FROM email_otps"):
            email = params[0]
            candidates = sorted(
                (r for r in self.rows if r["email"] == email and r["consumed_at"] is None),
                key=lambda r: r["created_at"],
                reverse=True,
            )
            if not candidates:
                return _Result(None)
            r = candidates[0]
            return _Result((r["id"], r["code_hash"], r["expires_at"], r["attempts"]))

        if s.startswith("UPDATE email_otps SET attempts"):
            (otp_id,) = params
            for r in self.rows:
                if r["id"] == otp_id:
                    r["attempts"] += 1
            return _Result(None)

        if s.startswith("UPDATE email_otps SET consumed_at"):
            (otp_id,) = params
            for r in self.rows:
                if r["id"] == otp_id:
                    r["consumed_at"] = self.now()
            return _Result(None)

        raise AssertionError(f"FakeOtpConn: unexpected SQL: {sql!r}")


class FakeJobsConn:
    """Enough of `psycopg.Connection` for `ujc_api.routers.jobs`: `jobs` and `crawl_runs` as
    in-memory lists, matched against the exact SQL `routers/jobs.py` issues."""

    def __init__(self, jobs: list[dict] | None = None, crawl_runs: list[dict] | None = None):
        self.jobs = jobs or []
        self.crawl_runs = crawl_runs or []

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        params = params or ()

        if s.startswith("SELECT") and "FROM jobs WHERE source !=" in s:
            params = list(params)
            i = 0
            excluded_source = params[i]
            i += 1
            q = None
            if "websearch_to_tsquery" in s:
                q = params[i]
                i += 1
            source_filter = None
            if "AND source = %s" in s:
                source_filter = params[i]
                i += 1
            remote_filter = "remote = true" in s
            cursor_state = None
            if "< (%s, %s)" in s:
                cursor_state = (params[i], params[i + 1])
                i += 2
            limit = params[i]

            def sort_key(job: dict) -> tuple:
                return (job.get("posted_at") or job["first_seen_at"], job["id"])

            rows = [j for j in self.jobs if j["source"] != excluded_source]
            if q:
                needle = q.lower()
                rows = [
                    j
                    for j in rows
                    if needle in j["title"].lower() or needle in (j.get("company") or "").lower()
                ]
            if source_filter:
                rows = [j for j in rows if j["source"] == source_filter]
            if remote_filter:
                rows = [j for j in rows if j.get("remote")]
            rows.sort(key=sort_key, reverse=True)
            if cursor_state:
                rows = [j for j in rows if sort_key(j) < cursor_state]
            rows = rows[:limit]
            return _Result(
                rows=[
                    (
                        j["id"],
                        j["source"],
                        j["url"],
                        j.get("apply_url"),
                        j["title"],
                        j["company"],
                        j.get("location"),
                        j.get("remote", False),
                        j.get("employment_type"),
                        j.get("salary_text"),
                        j.get("tags", []),
                        j.get("open_to"),
                        j.get("posted_at"),
                        j["first_seen_at"],
                        j.get("timezones"),
                        j.get("timezone_source"),
                        j.get("tech_stack"),
                        j.get("salary_min"),
                        j.get("salary_max"),
                        j.get("salary_currency"),
                        j.get("salary_period"),
                        j.get("salary_source"),
                        j.get("level"),
                        j.get("level_source"),
                    )
                    for j in rows
                ]
            )

        if s.startswith("SELECT") and "FROM jobs WHERE id = %s" in s:
            (job_id,) = params
            for job in self.jobs:
                if job["id"] == job_id:
                    return _Result(
                        (
                            job["id"],
                            job["source"],
                            job["url"],
                            job.get("apply_url"),
                            job["title"],
                            job["company"],
                            job.get("location"),
                            job.get("remote", False),
                            job.get("employment_type"),
                            job.get("salary_text"),
                            job.get("tags", []),
                            job.get("open_to"),
                            job.get("posted_at"),
                            job["first_seen_at"],
                            job.get("timezones"),
                            job.get("timezone_source"),
                            job.get("tech_stack"),
                            job.get("salary_min"),
                            job.get("salary_max"),
                            job.get("salary_currency"),
                            job.get("salary_period"),
                            job.get("salary_source"),
                            job.get("level"),
                            job.get("level_source"),
                            job.get("description"),
                            job.get("sections"),
                        )
                    )
            return _Result(None)

        if s.startswith("WITH job_counts AS"):
            totals: dict[str, int] = {}
            last_seen: dict[str, object] = {}
            for job in self.jobs:
                totals[job["source"]] = totals.get(job["source"], 0) + 1
                seen = job["first_seen_at"]
                if job["source"] not in last_seen or seen > last_seen[job["source"]]:
                    last_seen[job["source"]] = seen

            latest: dict[str, dict] = {}
            for run in sorted(self.crawl_runs, key=lambda r: r["started_at"]):
                latest[run["source"]] = run

            sources = sorted(set(totals) | set(latest))
            rows = []
            for source in sources:
                run = latest.get(source)
                total = totals.get(source, 0)
                if run is not None:
                    rows.append(
                        (
                            source,
                            run["status"],
                            run["started_at"],
                            run.get("finished_at"),
                            run.get("jobs_found", total),
                            run.get("jobs_new", 0),
                            total,
                        )
                    )
                else:
                    rows.append((source, "ok", last_seen[source], None, total, 0, total))
            return _Result(rows=rows)

        raise AssertionError(f"FakeJobsConn: unexpected SQL: {sql!r}")


class FakeWorkerConn:
    """Enough of `psycopg.Connection` for `ujc_api.worker`: `tasks`, `user_cvs`,
    `user_preferences`, `jobs` and `user_matches` as in-memory dicts, matched against the exact
    SQL `worker.py` issues."""

    def __init__(self):
        self.tasks: dict[int, dict] = {}
        self.user_cvs: dict[int, dict] = {}
        self.user_preferences: dict[int, dict] = {}
        self.jobs: dict[int, dict] = {}
        self.user_matches: dict[tuple[int, int], dict] = {}
        self._next_task_id = 1000
        self._in_transaction = False

    class _Txn:
        def __init__(self, conn):
            self.conn = conn

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    def transaction(self):
        return FakeWorkerConn._Txn(self)

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        params = params or ()

        if s.startswith("UPDATE tasks SET status='queued', locked_by=NULL"):
            n = 0
            for t in self.tasks.values():
                if t["status"] == "running":
                    t["status"] = "queued"
                    t["locked_by"] = None
                    t["locked_at"] = None
                    n += 1
            return _Result(rows=[None] * n)

        if s.startswith("UPDATE tasks SET status='running'"):
            worker = params["worker"]
            queued = sorted(
                (t for t in self.tasks.values() if t["status"] == "queued"),
                key=lambda t: t["id"],
            )
            if not queued:
                return _Result(None)
            t = queued[0]
            t["status"] = "running"
            t["locked_by"] = worker
            t["attempts"] += 1
            return _Result((t["id"], t["kind"], t["payload"], t["attempts"]))

        if s.startswith("UPDATE tasks SET status='done'"):
            (task_id,) = params
            self.tasks[task_id]["status"] = "done"
            self.tasks[task_id]["error"] = None
            return _Result(None)

        if s.startswith("UPDATE tasks SET status='error'"):
            short, task_id = params
            self.tasks[task_id]["status"] = "error"
            self.tasks[task_id]["error"] = short
            return _Result(None)

        if s.startswith("UPDATE tasks SET status='queued', run_after"):
            backoff_minutes, short, task_id = params
            self.tasks[task_id]["status"] = "queued"
            self.tasks[task_id]["error"] = short
            self.tasks[task_id]["run_after_backoff_minutes"] = backoff_minutes
            return _Result(None)

        if s.startswith("SELECT user_id, filename, content FROM user_cvs"):
            (cv_id,) = params
            row = self.user_cvs.get(cv_id)
            if row is None:
                return _Result(None)
            return _Result((row["user_id"], row["filename"], row["content"]))

        if s.startswith("UPDATE user_cvs SET status = 'processing'"):
            (cv_id,) = params
            self.user_cvs[cv_id]["status"] = "processing"
            return _Result(None)

        if s.startswith("UPDATE user_cvs SET status = 'done'"):
            text, profile, keywords, cv_id = params
            row = self.user_cvs[cv_id]
            row.update(
                status="done",
                text=text,
                profile=profile.obj if hasattr(profile, "obj") else profile,
                keywords=keywords,
                error=None,
            )
            return _Result(None)

        if s.startswith("UPDATE user_cvs SET status = %s"):
            status, short, cv_id = params
            self.user_cvs[cv_id]["status"] = status
            self.user_cvs[cv_id]["error"] = short
            return _Result(None)

        if s.startswith("SELECT keywords, candidate_country FROM user_preferences"):
            (user_id,) = params
            row = self.user_preferences.get(user_id)
            if row is None:
                return _Result(None)
            return _Result((row["keywords"], row["candidate_country"]))

        if s.startswith("INSERT INTO user_preferences"):
            user_id, keywords, candidate_country = params
            self.user_preferences[user_id] = {
                "keywords": keywords,
                "candidate_country": candidate_country,
            }
            return _Result(None)

        if s.startswith("INSERT INTO tasks (kind, payload) VALUES ('match_score'"):
            (payload,) = params
            task_id = self._next_task_id
            self._next_task_id += 1
            self.tasks[task_id] = {
                "id": task_id,
                "kind": "match_score",
                "payload": payload.obj if hasattr(payload, "obj") else payload,
                "status": "queued",
                "attempts": 0,
                "locked_by": None,
                "error": None,
            }
            return _Result(None)

        if s.startswith("SELECT id, profile FROM user_cvs WHERE user_id = %s AND status = 'done'"):
            (user_id,) = params
            candidates = sorted(
                (
                    r
                    for r in self.user_cvs.values()
                    if r["user_id"] == user_id and r.get("status") == "done"
                ),
                key=lambda r: r["created_at"],
                reverse=True,
            )
            if not candidates:
                return _Result(None)
            r = candidates[0]
            return _Result((r["id"], r["profile"]))

        if s.startswith("SELECT keywords, remote_only, candidate_country FROM user_preferences"):
            (user_id,) = params
            row = self.user_preferences.get(user_id)
            if row is None:
                return _Result(None)
            return _Result(
                (row["keywords"], row.get("remote_only", False), row["candidate_country"])
            )

        if s.startswith("SELECT id, title, company, location, remote, open_to, salary_text"):
            rows = sorted(self.jobs.values(), key=lambda j: j["id"], reverse=True)
            return _Result(
                rows=[
                    (
                        j["id"],
                        j["title"],
                        j["company"],
                        j.get("location"),
                        j.get("remote", False),
                        j.get("open_to"),
                        j.get("salary_text"),
                        j.get("employment_type"),
                        j.get("tags", []),
                        j.get("description", ""),
                    )
                    for j in rows
                ]
            )

        if s.startswith("DELETE FROM user_matches WHERE user_id = %s"):
            (user_id,) = params
            for key in [k for k in self.user_matches if k[0] == user_id]:
                del self.user_matches[key]
            return _Result(None)

        if s.startswith("INSERT INTO user_matches"):
            # One statement per run: `(user_id, cv_id, Jsonb([{job_id, score, ...}, ...]))`.
            user_id, cv_id, rows = params
            for m in rows.obj:
                self.user_matches[(user_id, m["job_id"])] = {
                    "cv_id": cv_id,
                    "score": m["score"],
                    "summary": m["summary"],
                    "reasons": m["reasons"],
                    "missing_skills": m["missing_skills"],
                }
            return _Result(None)

        raise AssertionError(f"FakeWorkerConn: unexpected SQL: {sql!r}")
