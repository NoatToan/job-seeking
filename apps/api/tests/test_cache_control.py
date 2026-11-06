"""HTTP caching policy (ujc_api.cache_control, docs/product/PERFORMANCE.md "Caching").

Public routes: `public, s-maxage, stale-while-revalidate` + ETag/304, identical bodies for
anonymous and signed-in requests, never `Set-Cookie`. Everything else: `private, no-store`.
"""

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from cb_fakes import InMemoryFeedbackRepository
from fakes import FakeJobsConn
from fastapi.testclient import TestClient

from ujc_api.auth.deps import AuthedUser, current_user, optional_user
from ujc_api.auth.ratelimit import SlidingWindowRateLimiter
from ujc_api.auth.session import SESSION_COOKIE
from ujc_api.cache_control import PRIVATE, public_route, weak_etag
from ujc_api.db import get_conn
from ujc_api.main import create_app
from ujc_api.routers.feedback import feedback_repo
from ujc_api.settings import Settings

USER = AuthedUser(id=7, email="signed-in@example.com")


class PublicConn(FakeJobsConn):
    """FakeJobsConn + the facets queries. Any other SQL (notably the session lookup
    `UPDATE sessions ...`) raises, which proves a public route never reads the session."""

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        if "unnest(countries)" in s:
            return _Rows([("AU", 2), ("US", 1)])
        if "unnest(tech_stack)" in s:
            return _Rows([("python", 3)])
        return super().execute(sql, params)


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


def _job(job_id: int) -> dict:
    return {
        "id": job_id,
        "source": "remoteok",
        "url": f"https://example.com/{job_id}",
        "title": f"Engineer {job_id}",
        "company": "Acme",
        "first_seen_at": datetime(2026, 1, job_id, tzinfo=UTC),
        "description": "Desc",
    }


@pytest.fixture
def app_client(monkeypatch) -> Iterator[TestClient]:
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "abc123")
    app = create_app(Settings(database_url="postgresql://unused/unused", ujc_env="test"))
    conn = PublicConn(jobs=[_job(1), _job(2)])
    repo = InMemoryFeedbackRepository()
    app.dependency_overrides[get_conn] = lambda: conn
    app.dependency_overrides[feedback_repo] = lambda: repo
    app.state.repo = repo
    with TestClient(app) as client:
        yield client


PUBLIC_PATHS = [
    ("/api/jobs", 300),
    ("/api/jobs?q=engineer&sort=newest", 300),
    ("/api/jobs/facets", 3600),
    ("/api/jobs/1", 3600),
    ("/api/sources", 300),
    ("/api/feedback/stats", 300),
]


@pytest.mark.parametrize(("path", "s_maxage"), PUBLIC_PATHS)
def test_public_routes_are_cdn_cacheable(app_client, path, s_maxage):
    resp = app_client.get(path)
    assert resp.status_code == 200
    cache_control = resp.headers["Cache-Control"]
    assert cache_control.startswith("public, ")
    assert f"s-maxage={s_maxage}" in cache_control
    assert "stale-while-revalidate=" in cache_control
    assert "private" not in cache_control and "no-store" not in cache_control
    assert resp.headers["ETag"].startswith('W/"')
    assert "set-cookie" not in resp.headers
    assert "vary" not in resp.headers  # never `Vary: Cookie` — the body doesn't depend on it
    assert resp.headers["X-Build-Id"] == "abc123"


@pytest.mark.parametrize(("path", "_s"), PUBLIC_PATHS)
def test_signed_in_request_gets_the_same_public_body(app_client, path, _s):
    """A session cookie must not change a public response (the CDN key ignores cookies). The fake
    connection raises on the session-lookup SQL, so this also proves the handler never reads it."""
    app_client.app.dependency_overrides[optional_user] = lambda: USER  # feedback's read_user
    anonymous = app_client.get(path)
    app_client.cookies.set(SESSION_COOKIE, "a-real-looking-session")
    signed_in = app_client.get(path)
    assert signed_in.status_code == anonymous.status_code == 200
    assert signed_in.content == anonymous.content
    assert signed_in.headers["ETag"] == anonymous.headers["ETag"]
    assert signed_in.headers["Cache-Control"] == anonymous.headers["Cache-Control"]


def test_matching_if_none_match_returns_304(app_client):
    first = app_client.get("/api/jobs/1")
    etag = first.headers["ETag"]
    assert etag == weak_etag(first.content)
    again = app_client.get("/api/jobs/1", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["ETag"] == etag
    assert again.headers["Cache-Control"].startswith("public, ")
    stale = app_client.get("/api/jobs/1", headers={"If-None-Match": 'W/"other"'})
    assert stale.status_code == 200


def test_public_route_errors_are_not_cached(app_client):
    missing = app_client.get("/api/jobs/999")
    assert missing.status_code == 404
    assert missing.headers["Cache-Control"] == PRIVATE
    assert "etag" not in missing.headers
    bad = app_client.get("/api/jobs?sort=bogus")
    assert bad.status_code == 400
    assert bad.headers["Cache-Control"] == PRIVATE


def test_public_route_with_authorization_header_is_private(app_client):
    resp = app_client.get("/api/jobs/1", headers={"Authorization": "Bearer ujc_pat_x"})
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == PRIVATE


def test_personal_routes_are_private_no_store(app_client, monkeypatch):
    # Anonymous: 401s are private.
    for path in ("/api/me", "/api/feed", "/api/me/viewed", "/api/applications", "/api/platforms"):
        resp = app_client.get(path)
        assert resp.status_code == 401, path
        assert resp.headers["Cache-Control"] == PRIVATE, path
    # Signed in: a personal 200 is private too.
    app_client.app.dependency_overrides[current_user] = lambda: USER
    monkeypatch.setattr(
        "ujc_api.routers.platforms.platform_catalogue", lambda conn, user_id, settings: []
    )
    resp = app_client.get("/api/platforms")
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == PRIVATE
    assert "etag" not in resp.headers


def test_csrf_and_feedback_board_are_private(app_client):
    csrf = app_client.get("/api/auth/csrf")
    assert "set-cookie" in csrf.headers
    assert "no-store" in csrf.headers["Cache-Control"]  # the handler's own header is kept
    # The board list carries the viewer's own votes/authorship when signed in: never cached.
    board = app_client.get("/api/feedback?scope=board")
    assert board.status_code == 200
    assert board.headers["Cache-Control"] == PRIVATE


def test_health_and_unknown_routes_are_private(client):
    assert client.get("/api/health").headers["Cache-Control"] == PRIVATE
    assert client.get("/api/nope").headers["Cache-Control"] == PRIVATE


def test_route_classification():
    assert public_route("GET", "/api/jobs") is not None
    assert public_route("GET", "/api/jobs/42") is not None
    assert public_route("POST", "/api/jobs") is None
    assert public_route("GET", "/api/jobs/42/extra") is None
    assert public_route("GET", "/api/feed") is None
    assert public_route("GET", "/api/feedback") is None
    assert public_route("GET", "/api/feedback/12") is None
    assert public_route("GET", "/api/me/viewed") is None


def test_rate_limiter_drops_expired_keys():
    clock = {"t": 0.0}
    limiter = SlidingWindowRateLimiter(max_count=5, window_seconds=60, clock=lambda: clock["t"])
    for i in range(1000):
        limiter.allow(f"10.0.{i // 256}.{i % 256}")
    assert len(limiter) == 1000
    clock["t"] += 61
    limiter.allow("1.1.1.1")
    assert len(limiter) == 1  # every key whose hits left the window is gone


def test_rate_limiter_is_bounded_by_max_keys():
    limiter = SlidingWindowRateLimiter(max_count=1, window_seconds=3600, max_keys=100)
    for i in range(10_000):
        limiter.allow(f"key-{i}")
    assert len(limiter) == 100
    # The most recent keys are the ones kept, and still limited.
    assert limiter.allow("key-9999") is False
