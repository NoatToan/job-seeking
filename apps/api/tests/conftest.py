"""Shared fixtures.

`client` never touches a database (app creation and /api/health are DB-free), so it is safe for
every non-DB test. DB-backed tests ask for `migrated_database_url` instead, which skips with a
clear message when `TEST_DATABASE_URL` is unset.
"""

import os
import uuid
from collections.abc import Iterator

# Tests must never call a real LLM: the shared test schema can hand a worker a queued
# `match_score` task from another test, which would otherwise shell out to the `claude` CLI.
os.environ["UJC_LLM_PROVIDER"] = "fake"

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from ujc_api.main import create_app
from ujc_api.migrate import apply_migrations
from ujc_api.settings import Settings


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(Settings(database_url="postgresql://unused/unused", ujc_env="test"))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; skipping tests that need a database")
    return url


@pytest.fixture(scope="session")
def migrated_database_url(test_database_url: str) -> Iterator[str]:
    """A connection URL scoped (via `search_path`) to a throwaway schema with every migration
    applied, so tests never touch the real `public` schema. Dropped at the end of the session.
    """
    schema = f"ujc_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(test_database_url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    scoped_url = make_conninfo(test_database_url, options=f"-c search_path={schema}")
    try:
        with psycopg.connect(scoped_url, autocommit=True) as conn:
            apply_migrations(conn)
        yield scoped_url
    finally:
        with psycopg.connect(test_database_url, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


@pytest.fixture(autouse=True)
def _reset_ip_rate_limiter() -> Iterator[None]:
    """`otp.ip_rate_limiter` is an in-process singleton (by design — see its docstring), so
    without this it accumulates hits across every test in the whole pytest run (all sharing the
    test client's fake IP) instead of just within one test."""
    from ujc_api.auth import otp

    otp.ip_rate_limiter.reset()
    yield
    otp.ip_rate_limiter.reset()


@pytest.fixture(autouse=True)
def _reset_generic_rate_limiters() -> Iterator[None]:
    """Same reasoning as `_reset_ip_rate_limiter`, for the generic per-IP unsafe-method and
    per-user live-search limiters added in `ujc_api.rate_limit`."""
    from ujc_api.rate_limit import reset_rate_limiters

    reset_rate_limiters()
    yield
    reset_rate_limiters()
