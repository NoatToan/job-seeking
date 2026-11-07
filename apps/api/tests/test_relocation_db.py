"""`relocation=` on `GET /api/jobs` and `GET /api/feed` against a real (throwaway-schema)
Postgres: the columns from migration 032, the filter values, and the `relocation` DTO field.
Skipped when `TEST_DATABASE_URL` is unset (conftest.py `migrated_database_url`)."""

from datetime import UTC, datetime

import psycopg
import pytest
from fastapi.testclient import TestClient

from ujc_api.auth.session import create_session
from ujc_api.main import create_app
from ujc_api.settings import Settings

SOURCE = "relocation-test"

# title -> (relocation_support, relocation_required)
JOBS = {
    "Helps you move": (True, None),
    "Must move, helps": (True, True),
    "Must move, no help": (False, True),
    "No relocation": (False, None),
    "Says nothing": (None, None),
}


@pytest.fixture(scope="module")
def client(migrated_database_url: str) -> TestClient:
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute("DELETE FROM jobs WHERE source = %s", (SOURCE,))
        for n, (title, (support, required)) in enumerate(JOBS.items()):
            conn.execute(
                "INSERT INTO jobs (source, external_id, url, title, company, first_seen_at,"
                " relocation_support, relocation_required)"
                " VALUES (%s, %s, %s, %s, 'Acme', %s, %s, %s)",
                (
                    SOURCE,
                    f"r{n}",
                    f"https://example.com/r{n}",
                    title,
                    datetime(2026, 10, 1 + n, tzinfo=UTC),
                    support,
                    required,
                ),
            )
    settings = Settings(
        database_url=migrated_database_url, ujc_env="test", ujc_secret_key="relocation-secret"
    )
    return TestClient(create_app(settings), base_url="https://testserver")


def _titles(client: TestClient, path: str) -> set[str]:
    resp = client.get(path)
    assert resp.status_code == 200, resp.text
    return {j["title"] for j in resp.json()["items"]}


@pytest.mark.parametrize(
    ("relocation", "expected"),
    [
        ("support", {"Helps you move", "Must move, helps"}),
        ("required", {"Must move, helps", "Must move, no help"}),
        ("support,required", {"Must move, helps"}),  # every value applies
        ("SUPPORT, bogus", {"Helps you move", "Must move, helps"}),  # unknown values ignored
        ("", set(JOBS)),
    ],
)
def test_public_list_filter(client: TestClient, relocation: str, expected: set[str]):
    path = f"/api/jobs?source={SOURCE}&limit=50&relocation={relocation}"
    assert _titles(client, path) == expected


def test_dto_carries_both_signals(client: TestClient):
    items = client.get(f"/api/jobs?source={SOURCE}&limit=50").json()["items"]
    by_title = {j["title"]: j["relocation"] for j in items}
    assert by_title["Must move, no help"] == {"support": False, "required": True}
    assert by_title["Says nothing"] == {"support": None, "required": None}
    detail = client.get(f"/api/jobs/{items[0]['id']}").json()
    assert set(detail["relocation"]) == {"support", "required"}


def test_feed_filter(client: TestClient, migrated_database_url: str):
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        user_id = conn.execute(
            "INSERT INTO users (email) VALUES ('relocation@example.com')"
            " ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id"
        ).fetchone()[0]
        token = create_session(conn, user_id)
    client.cookies.set("ujc_session", token)
    try:
        titles = _titles(client, f"/api/feed?source={SOURCE}&limit=50&relocation=required")
    finally:
        client.cookies.clear()
    assert titles == {"Must move, helps", "Must move, no help"}
