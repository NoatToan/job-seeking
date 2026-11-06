"""Query-count regression tests (N+1 guard) against a real (throwaway-schema) Postgres database.

Every request runs on a connection whose cursors count the statements they execute. Each list
endpoint is measured with a few rows, then again after adding many more: the count must not grow
with the data, and must equal the documented constant (docs/product/PERFORMANCE.md "Query
counts"). A new per-row query, or an extra lookup per request, fails here.

Skipped when `TEST_DATABASE_URL` is unset (see conftest.py `migrated_database_url`).
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from itertools import count

import psycopg
import pytest
from fastapi.testclient import TestClient
from job_crawler.matching.scorer import MatchResult
from psycopg.types.json import Jsonb

from ujc_api import digest, worker
from ujc_api.db import get_conn
from ujc_api.main import create_app
from ujc_api.settings import Settings

QUERIES: list[str] = []
_ids = count(1)


class CountingCursor(psycopg.Cursor):
    def execute(self, query, params=None, **kwargs):  # type: ignore[override]
        QUERIES.append(str(query))
        return super().execute(query, params, **kwargs)

    def executemany(self, query, params_seq, **kwargs):  # type: ignore[override]
        params_seq = list(params_seq)
        QUERIES.extend([str(query)] * len(params_seq))
        return super().executemany(query, params_seq, **kwargs)


def _counting_connect(url: str, **kwargs) -> psycopg.Connection:
    return psycopg.connect(url, cursor_factory=CountingCursor, **kwargs)


@pytest.fixture
def client(migrated_database_url: str) -> Iterator[TestClient]:
    settings = Settings(
        database_url=migrated_database_url,
        ujc_env="test",
        ujc_secret_key="query-count-secret",
        ujc_otp_review_mode=True,
    )
    app = create_app(settings)

    def counting_conn() -> Iterator[psycopg.Connection]:
        with _counting_connect(migrated_database_url) as conn:
            yield conn

    app.dependency_overrides[get_conn] = counting_conn
    with TestClient(app, base_url="https://testserver") as c:
        yield c


def _sign_in(client: TestClient, email: str) -> int:
    code = client.post("/api/auth/otp", json={"email": email}).json()["devCode"]
    assert client.post("/api/auth/verify", json={"email": email, "code": code}).status_code == 200
    return int(client.get("/api/me").json()["user"]["id"])


def _db(url: str) -> psycopg.Connection:
    return psycopg.connect(url, autocommit=True)


def _add_jobs(url: str, source: str, n: int) -> list[int]:
    """n jobs that match the feed keyword 'python', each with a country and a tech id."""
    with _db(url) as conn:
        rows = conn.execute(
            "INSERT INTO jobs (source, external_id, url, title, company, remote, description,"
            "  countries, tech_stack, first_seen_at)"
            " SELECT %(source)s, %(prefix)s || g, 'https://example.test/' || %(prefix)s || g,"
            "  'Python Engineer ' || g, 'Acme', g %% 2 = 0, 'Build Python services.',"
            "  ARRAY['VN'], ARRAY['python'], now() - g * interval '1 minute'"
            " FROM generate_series(1, %(n)s) g RETURNING id",
            {"source": source, "prefix": f"qc{next(_ids)}-", "n": n},
        ).fetchall()
    return [r[0] for r in rows]


def _track(url: str, user_id: int, job_ids: list[int]) -> None:
    with _db(url) as conn:
        conn.execute(
            "INSERT INTO applications (user_id, job_id, job_snapshot)"
            " SELECT %s, j, '{}'::jsonb FROM unnest(%s::bigint[]) j ON CONFLICT DO NOTHING",
            (user_id, job_ids),
        )
        conn.execute(
            "INSERT INTO job_views (user_id, job_id)"
            " SELECT %s, j FROM unnest(%s::bigint[]) j ON CONFLICT DO NOTHING",
            (user_id, job_ids),
        )
        cv = conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, status)"
            " VALUES (%s, 'cv.pdf', 'application/pdf', ''::bytea, 'done') RETURNING id",
            (user_id,),
        ).fetchone()
        conn.execute(
            "INSERT INTO user_matches (user_id, cv_id, job_id, score, summary)"
            " SELECT %s, %s, j, 50 + j %% 50, 'fit' FROM unnest(%s::bigint[]) j"
            " ON CONFLICT DO NOTHING",
            (user_id, cv[0], job_ids),
        )
        items = conn.execute(
            "INSERT INTO feedback_items (kind, title, status, author_id)"
            " SELECT 'idea', 'Idea number ' || g, 'planned', %s"
            " FROM generate_series(1, %s) g RETURNING id",
            (user_id, len(job_ids)),
        ).fetchall()
        conn.execute(
            "INSERT INTO feedback_votes (item_id, user_id, value)"
            " SELECT i, %s, 1 FROM unnest(%s::bigint[]) i",
            (user_id, [i[0] for i in items]),
        )


def _queries(client: TestClient, path: str) -> int:
    QUERIES.clear()
    resp = client.get(path)
    assert resp.status_code == 200, resp.text
    return len(QUERIES)


# Statements per request, independent of how many rows the response holds. Signed-in requests
# include the one session lookup (`auth.session.lookup_user`); public routes skip it.
SIGNED_IN = {
    # Public, CDN-cached routes never read the session (ujc_api.cache_control): page only.
    "/api/jobs": 1,
    "/api/jobs?country=VN&tech=python": 1,
    "/api/jobs/facets": 2,  # countries + tech
    "/api/sources": 1,
    "/api/feed": 3,  # session + preferences + page (with the match LEFT JOIN)
    "/api/feed?sort=match": 3,
    "/api/jobs?sort=salary": 1,
    "/api/me": 2,  # session + one statement for profile, role, preferences and latest CV
    "/api/me/profile": 2,
    "/api/applications": 2,
    "/api/me/viewed": 2,
    # session + admin role + count + page (scores and comment counts are stored columns)
    "/api/feedback?scope=board": 4,
    "/api/feedback?scope=mine&sort=top": 4,
}


def test_list_endpoints_run_a_constant_number_of_queries(
    client: TestClient, migrated_database_url: str
):
    user_id = _sign_in(client, "query-count@example.com")
    with _db(migrated_database_url) as conn:
        conn.execute(
            "INSERT INTO user_preferences (user_id, keywords) VALUES (%s, '{python}')"
            " ON CONFLICT (user_id) DO UPDATE SET keywords = EXCLUDED.keywords",
            (user_id,),
        )

    _track(migrated_database_url, user_id, _add_jobs(migrated_database_url, "qc-src", 2))
    small = {path: _queries(client, path) for path in SIGNED_IN}

    _track(migrated_database_url, user_id, _add_jobs(migrated_database_url, "qc-src", 40))
    large = {path: _queries(client, path) for path in SIGNED_IN}

    assert large == small, "query count grew with the number of rows (N+1)"
    assert large == SIGNED_IN

    # The single-statement /api/me still returns every part (newest CV, stored preferences).
    me = client.get("/api/me").json()
    assert me["user"]["role"] == "user"
    assert me["preferences"]["keywords"] == ["python"]
    assert me["preferences"]["digestHour"] == 7
    assert me["latestCv"]["status"] == "done"

    # Signed out: the public catalogue is a single statement.
    client.cookies.clear()
    assert _queries(client, "/api/jobs?remote=true") == 1
    assert _queries(client, "/api/feedback?scope=board") == 2  # count + page
    # "Load more" is a keyset page: no count, one statement.
    cursor = client.get("/api/feedback?scope=board&limit=1").json()["nextCursor"]
    assert cursor
    assert _queries(client, f"/api/feedback?scope=board&limit=1&cursor={cursor}") == 1


def test_match_score_writes_all_matches_in_one_statement(migrated_database_url: str):
    with _db(migrated_database_url) as conn:
        user_id = conn.execute(
            "INSERT INTO users (email) VALUES ('qc-worker@example.com') RETURNING id"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, status, profile)"
            " VALUES (%s, 'cv.pdf', 'application/pdf', ''::bytea, 'done', %s)",
            (user_id, Jsonb({"skills": ["python"], "search_keywords": ["python"]})),
        )
        conn.execute(
            "INSERT INTO user_preferences (user_id, keywords) VALUES (%s, '{python}')", (user_id,)
        )
    job_ids = _add_jobs(migrated_database_url, "qc-worker", 12)

    def run(n: int) -> int:
        def score(_profile, _cv, jobs):
            return [
                MatchResult(j.id, 70, "fit", ["python"], ["go"]) for j in jobs if j.id in job_ids
            ][:n]

        QUERIES.clear()
        with _counting_connect(migrated_database_url, autocommit=True) as conn:
            worker.process_match_score(conn, {"user_id": user_id}, score_jobs_fn=score)
        return len(QUERIES)

    few, many = run(1), run(8)
    # cv + preferences + candidates + DELETE + one INSERT, however many jobs were scored
    assert few == many == 5
    with _db(migrated_database_url) as conn:
        rows = conn.execute(
            "SELECT score, reasons, missing_skills FROM user_matches WHERE user_id = %s",
            (user_id,),
        ).fetchall()
    assert len(rows) >= 8  # every scored job, from more than one LLM batch
    assert all(r == (70, ["python"], ["go"]) for r in rows)


def test_digest_runs_two_queries_per_due_user(migrated_database_url: str):
    """One scan for the due users (preferences included), then per user: the jobs query and the
    `last_digest_at` update. The per-user jobs query is inherent (every user has their own
    filters); there's no extra per-user `user_preferences` lookup."""
    settings = Settings(
        database_url=migrated_database_url, ujc_env="test", ujc_secret_key="qc", resend_api_key=None
    )
    now = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
    _add_jobs(migrated_database_url, "qc-digest", 3)

    mine: list[int] = []

    def add_users(n: int) -> None:
        with _db(migrated_database_url) as conn:
            for _ in range(n):
                uid = conn.execute(
                    "INSERT INTO users (email) VALUES (%s) RETURNING id",
                    (f"qc-digest-{next(_ids)}@example.com",),
                ).fetchone()[0]
                conn.execute(
                    "INSERT INTO user_preferences (user_id, keywords, digest_hour, digest_tz,"
                    " last_digest_at) VALUES (%s, '{python}', 0, 'UTC', %s)",
                    (uid, now - timedelta(days=1)),
                )
                mine.append(uid)

    def run() -> tuple[int, int]:
        QUERIES.clear()
        with _counting_connect(migrated_database_url, autocommit=True) as conn:
            counts = digest.run_digest(conn, settings, now=now)
        with _db(migrated_database_url) as conn:  # due again for the next run
            conn.execute(
                "UPDATE user_preferences SET last_digest_at = %s WHERE user_id = ANY(%s)",
                (now - timedelta(days=1), mine),
            )
        return len(QUERIES), sum(counts.values())

    with _db(migrated_database_url) as conn:  # only this test's users are due
        others = conn.execute(
            "UPDATE user_preferences SET digest_enabled = false WHERE digest_enabled"
            " RETURNING user_id"
        ).fetchall()
    try:
        add_users(2)
        q2, users2 = run()
        add_users(3)
        q5, users5 = run()
    finally:
        with _db(migrated_database_url) as conn:
            conn.execute(
                "UPDATE user_preferences SET digest_enabled = true WHERE user_id = ANY(%s)",
                ([r[0] for r in others],),
            )
    assert (users2, users5) == (2, 5)
    assert q2 == 1 + 2 * 2
    assert q5 == 1 + 2 * 5
