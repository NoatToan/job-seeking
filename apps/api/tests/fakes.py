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


class FakeWorkerConn:
    """Enough of `psycopg.Connection` for `ujc_api.worker`: `tasks`, `user_cvs` and
    `user_preferences` as in-memory dicts, matched against the exact SQL `worker.py` issues."""

    def __init__(self):
        self.tasks: dict[int, dict] = {}
        self.user_cvs: dict[int, dict] = {}
        self.user_preferences: dict[int, dict] = {}
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

        raise AssertionError(f"FakeWorkerConn: unexpected SQL: {sql!r}")
