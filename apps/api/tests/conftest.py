"""Shared fixtures.

`client` never touches a database (app creation and /api/health are DB-free), so it is safe for
every non-DB test. DB-backed tests ask for `migrated_database_url` instead, which skips with a
clear message when `TEST_DATABASE_URL` is unset.
"""

import os
import uuid
from collections.abc import Iterator

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
