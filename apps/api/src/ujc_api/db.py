"""The request-scoped connection pool. Plain psycopg, no ORM (see job_crawler.db for precedent)."""

from collections.abc import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from ujc_api.settings import Settings, get_settings

_pool: ConnectionPool | None = None


def get_pool(settings: Settings | None = None) -> ConnectionPool:
    """Returns the process-wide pool, opening it (lazily, on first use) if needed."""
    global _pool
    if _pool is None:
        settings = settings or get_settings()
        _pool = ConnectionPool(conninfo=settings.database_url, min_size=1, max_size=5, open=False)
        _pool.open()
    return _pool


def close_pool() -> None:
    """Closes and forgets the pool, if one was opened. Called on app shutdown and by tests."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_conn() -> Iterator[psycopg.Connection]:
    """FastAPI dependency: yields a pooled connection for the lifetime of one request."""
    with get_pool().connection() as conn:
        yield conn
