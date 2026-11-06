"""`sort=` on `GET /api/jobs` and `GET /api/feed` against a real (throwaway-schema) Postgres:
the order of every sort, the `salary_usd_year` column (migration 025), and keyset pagination
across pages — every job exactly once, in order, including ties on the sort key and on the date.
Skipped when `TEST_DATABASE_URL` is unset (conftest.py `migrated_database_url`)."""

import base64
import json
from datetime import UTC, datetime, timedelta
from itertools import cycle

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.auth.session import create_session
from ujc_api.main import create_app
from ujc_api.settings import Settings

SOURCE = "sort-test"
BASE = datetime(2026, 10, 1, tzinfo=UTC)

# (timezones, expected gap in whole hours from Asia/Ho_Chi_Minh (UTC+7, no DST); None = unknown)
ZONES = [
    (["UTC+07:00"], 0),
    (["Asia/Bangkok"], 0),
    (["UTC-05:00", "UTC+07:00"], 0),  # any of them: the best one counts
    (["Asia/Singapore"], 1),
    (["Asia/Kolkata"], 1),  # +5:30 is 90 min off -> 1 whole hour
    (["UTC+01:00"], 6),
    (["UTC-05:00"], 12),
    (["UTC+14:00"], 7),
    (None, None),
    (["Mars/Olympus_Mons"], None),  # not a zone we know: same as unknown
]

# (min, max, currency, period, expected salary_usd_year; None = not comparable)
SALARIES = [
    (120_000, 150_000, "USD", "year", 150_000),
    (30_000_000, 30_000_000, "VND", "month", 14_118),  # 30M x 12 / 25,500
    (None, 60, "EUR", "hour", 135_652),  # 60 x 2080 / 0.92
    (100_000, None, "USD", "year", 100_000),  # "from 100k": min only
    (150_000, 150_000, "USD", "year", 150_000),  # tie with the first
    (5_000, 7_000, None, "month", None),  # unknown currency
    None,
]


def _settings(url: str) -> Settings:
    return Settings(database_url=url, ujc_env="test", ujc_secret_key="sort-test-secret")


@pytest.fixture(scope="module")
def seeded(migrated_database_url: str) -> list[dict]:
    """60 jobs cycling through the zones / salaries above; posted dates repeat (ties) and some
    jobs have only `first_seen_at`."""
    jobs: list[dict] = []
    zones, salaries = cycle(ZONES), cycle(SALARIES)
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute("DELETE FROM jobs WHERE source = %s", (SOURCE,))
        for n in range(60):
            tz, gap = next(zones)
            salary = next(salaries)
            posted = BASE + timedelta(days=n % 9) if n % 4 else None
            first_seen = BASE + timedelta(days=n % 5, hours=1)
            smin, smax, cur, period, usd = salary if salary else (None, None, None, None, None)
            row = conn.execute(
                "INSERT INTO jobs (source, external_id, url, title, company, posted_at,"
                " first_seen_at, timezones, salary_min, salary_max, salary_currency,"
                " salary_period, salary_source)"
                " VALUES (%s, %s, %s, %s, 'Acme', %s, %s, %s, %s, %s, %s, %s, %s)"
                " RETURNING id, salary_usd_year",
                (
                    SOURCE,
                    f"job-{n}",
                    f"https://example.test/{n}",
                    f"Engineer {n}",
                    posted,
                    first_seen,
                    tz,
                    smin,
                    smax,
                    cur,
                    period,
                    "description" if salary else None,
                ),
            ).fetchone()
            assert row is not None
            assert row[1] == usd, f"salary_usd_year for {salary}"
            jobs.append({"id": row[0], "t": posted or first_seen, "gap": gap, "usd": usd})
    return jobs


@pytest.fixture
def client(migrated_database_url: str):
    with TestClient(
        create_app(_settings(migrated_database_url)), base_url="https://testserver"
    ) as c:
        yield c


def _all_pages(client: TestClient, path: str, **params) -> list[int]:
    ids: list[int] = []
    cursor = None
    for _ in range(100):
        resp = client.get(path, params={**params, "limit": 7, "cursor": cursor})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["items"]) <= 7
        ids.extend(int(item["id"]) for item in body["items"])
        cursor = body["nextCursor"]
        if not cursor:
            return ids
    raise AssertionError("pagination did not end")


def _expected(jobs: list[dict], key) -> list[int]:
    return [j["id"] for j in sorted(jobs, key=lambda j: (key(j), j["t"], j["id"]), reverse=True)]


def test_newest_is_posted_date_else_first_seen(client: TestClient, seeded: list[dict]):
    ids = _all_pages(client, "/api/jobs", source=SOURCE)
    assert ids == _expected(seeded, lambda j: 0)
    assert _all_pages(client, "/api/jobs", source=SOURCE, sort="newest") == ids


def test_salary_sort_pages_highest_first_unknown_last(client: TestClient, seeded: list[dict]):
    ids = _all_pages(client, "/api/jobs", source=SOURCE, sort="salary")
    assert len(ids) == len(set(ids)) == len(seeded)
    assert ids == _expected(seeded, lambda j: j["usd"] if j["usd"] is not None else -1)


def test_timezone_sort_pages_closest_first_unknown_last(client: TestClient, seeded: list[dict]):
    ids = _all_pages(client, "/api/jobs", source=SOURCE, sort="timezone", tz="Asia/Ho_Chi_Minh")
    assert len(ids) == len(set(ids)) == len(seeded)
    assert ids == _expected(seeded, lambda j: -j["gap"] if j["gap"] is not None else -99)
    # A fixed "UTC±hh:mm" offset works as the viewer's zone too.
    assert _all_pages(client, "/api/jobs", source=SOURCE, sort="timezone", tz="UTC+07:00") == ids


@pytest.mark.parametrize(
    ("params", "code"),
    [
        ({"sort": "bogus"}, "invalid_sort"),
        ({"sort": "match"}, "invalid_sort"),  # needs a CV score: feed only
        ({"sort": "timezone"}, "invalid_timezone"),
        ({"sort": "timezone", "tz": "Not/AZone"}, "invalid_timezone"),
    ],
)
def test_bad_sort_params_are_400(client: TestClient, params: dict, code: str):
    resp = client.get("/api/jobs", params=params)
    assert resp.status_code == 400
    assert code in resp.text


def test_a_cursor_only_works_for_the_sort_it_came_from(client: TestClient, seeded: list[dict]):
    first = client.get("/api/jobs", params={"source": SOURCE, "sort": "salary", "limit": 5}).json()
    cursor = first["nextCursor"]
    assert cursor
    for params in ({}, {"sort": "timezone", "tz": "Asia/Ho_Chi_Minh"}):
        resp = client.get("/api/jobs", params={"source": SOURCE, "cursor": cursor, **params})
        assert resp.status_code == 400
        assert "invalid_cursor" in resp.text
    forged = base64.urlsafe_b64encode(
        json.dumps({"s": "salary", "k": True, "t": BASE.isoformat(), "i": 1}).encode()
    ).decode()
    resp = client.get("/api/jobs", params={"source": SOURCE, "sort": "salary", "cursor": forged})
    assert resp.status_code == 400


def _sign_in(client: TestClient, url: str) -> int:
    with psycopg.connect(url, autocommit=True) as conn:
        row = conn.execute(
            "INSERT INTO users (email) VALUES ('sorter@example.com')"
            " ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id"
        ).fetchone()
        assert row is not None
        client.cookies.set("ujc_session", create_session(conn, row[0]))
    return row[0]


def test_feed_match_sort_pages_best_score_first_unscored_last(
    client: TestClient, seeded: list[dict], migrated_database_url: str
):
    user_id = _sign_in(client, migrated_database_url)
    scores: dict[int, int] = {}
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        cv = conn.execute(
            "INSERT INTO user_cvs (user_id, filename, mime, content, status)"
            " VALUES (%s, 'cv.pdf', 'application/pdf', '', 'done') RETURNING id",
            (user_id,),
        ).fetchone()
        assert cv is not None
        conn.execute("DELETE FROM user_matches WHERE user_id = %s", (user_id,))
        for n, job in enumerate(seeded[:40]):  # 20 jobs stay unscored
            scores[job["id"]] = (n * 7) % 5 * 20  # 0..80, many ties
            conn.execute(
                "INSERT INTO user_matches (user_id, cv_id, job_id, score, summary)"
                " VALUES (%s, %s, %s, %s, 'ok')",
                (user_id, cv[0], job["id"], scores[job["id"]]),
            )

    ids = _all_pages(client, "/api/feed", source=SOURCE, sort="match")
    assert ids == _expected(seeded, lambda j: scores.get(j["id"], -1))
    # `score` is the pre-sort-options name of the same order.
    assert _all_pages(client, "/api/feed", source=SOURCE, sort="score") == ids
    # Every public sort works on the feed too.
    salary_ids = _all_pages(client, "/api/feed", source=SOURCE, sort="salary")
    assert salary_ids == _expected(seeded, lambda j: j["usd"] if j["usd"] is not None else -1)
    tz_ids = _all_pages(client, "/api/feed", source=SOURCE, sort="timezone", tz="Asia/Saigon")
    assert tz_ids == _expected(seeded, lambda j: -j["gap"] if j["gap"] is not None else -99)
