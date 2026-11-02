"""`require_scope` and `require_csrf_unless_bearer` (M3-08), on a throwaway app with an in-memory
`personal_tokens` fake — no real Postgres needed (contrast with test_tokens_db.py)."""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from ujc_api.auth.csrf import require_csrf_unless_bearer
from ujc_api.auth.deps import AuthedUser, hash_pat, require_scope
from ujc_api.db import get_conn
from ujc_api.main import register_exception_handlers

RAW_TOKEN = "ujc_pat_test-token-value"


class _Result:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class FakeTokenConn:
    """Enough of `psycopg.Connection` for `require_scope`'s two queries: look up a token by
    hash, and bump `last_used_at` on a hit."""

    def __init__(self, token_row: tuple | None):
        self.token_row = token_row
        self.last_used_updates = 0

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        if s.startswith("SELECT pt.id, pt.user_id, pt.scopes, u.email"):
            (token_hash,) = params
            if self.token_row is not None and self.token_row[0] == token_hash:
                return _Result(self.token_row[1])
            return _Result(None)
        if s.startswith("UPDATE personal_tokens SET last_used_at"):
            self.last_used_updates += 1
            return _Result(None)
        raise AssertionError(f"FakeTokenConn: unexpected SQL: {sql!r}")


def _app(conn: FakeTokenConn) -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)
    app.dependency_overrides[get_conn] = lambda: conn

    @app.get("/jobs-read")
    def jobs_read(user: AuthedUser = Depends(require_scope("jobs:read"))) -> dict:  # noqa: B008
        return {"userId": user.id}

    @app.post("/writes", dependencies=[Depends(require_csrf_unless_bearer)])
    def writes(
        user: AuthedUser = Depends(require_scope("applications:write")),  # noqa: B008
    ) -> dict:
        return {"userId": user.id}

    return app


def _active_token_row(scopes: list[str]) -> tuple:
    """`(token_hash, db_row)` for an active token, matching `require_scope`'s query shape
    `(id, user_id, scopes, email)`."""
    return (hash_pat(RAW_TOKEN), (1, 42, scopes, "person@example.com"))


def test_no_auth_at_all_is_unauthorized():
    with TestClient(_app(FakeTokenConn(None))) as client:
        resp = client.get("/jobs-read")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_valid_bearer_token_with_declared_scope_succeeds_and_bumps_last_used():
    conn = FakeTokenConn(_active_token_row(["jobs:read"]))
    with TestClient(_app(conn)) as client:
        resp = client.get("/jobs-read", headers={"Authorization": f"Bearer {RAW_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json() == {"userId": 42}
    assert conn.last_used_updates == 1


def test_bearer_token_missing_the_declared_scope_is_forbidden():
    conn = FakeTokenConn(_active_token_row(["applications:write"]))
    with TestClient(_app(conn)) as client:
        resp = client.get("/jobs-read", headers={"Authorization": f"Bearer {RAW_TOKEN}"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"
    assert conn.last_used_updates == 0


def test_unknown_bearer_token_is_unauthorized():
    conn = FakeTokenConn(_active_token_row(["jobs:read"]))
    with TestClient(_app(conn)) as client:
        resp = client.get("/jobs-read", headers={"Authorization": "Bearer ujc_pat_wrong"})
    assert resp.status_code == 401


def test_bearer_token_without_the_prefix_is_unauthorized():
    conn = FakeTokenConn(None)
    with TestClient(_app(conn)) as client:
        resp = client.get("/jobs-read", headers={"Authorization": "Bearer not-a-pat"})
    assert resp.status_code == 401


def test_bearer_skips_csrf_but_session_header_absence_still_needs_valid_token():
    conn = FakeTokenConn(_active_token_row(["applications:write"]))
    with TestClient(_app(conn)) as client:
        # No X-CSRF-Token header at all; a session-cookie request would 403 here, but the
        # bearer token exempts this request from the CSRF check entirely.
        resp = client.post("/writes", headers={"Authorization": f"Bearer {RAW_TOKEN}"})
    assert resp.status_code == 200


def test_csrf_is_still_enforced_with_no_bearer_header():
    with TestClient(_app(FakeTokenConn(None))) as client:
        resp = client.post("/writes")
    # No Authorization header -> require_csrf_unless_bearer falls through to require_csrf,
    # which 403s before require_scope ever runs (no session cookie either).
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_failed"
