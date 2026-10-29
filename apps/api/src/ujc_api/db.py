"""The request-scoped connection pool. Plain psycopg, no ORM (see job_crawler.db for precedent)."""

from collections.abc import Iterator

import psycopg
from fastapi import Depends
from psycopg_pool import ConnectionPool

from ujc_api.deps import app_settings
from ujc_api.settings import Settings, get_settings

_pool: ConnectionPool | None = None
_pool_conninfo: str | None = None


def get_pool(settings: Settings | None = None) -> ConnectionPool:
    """Returns the process-wide pool, opening it (lazily, on first use) if needed.

    Reopens it if `settings.database_url` differs from what's already open — the normal case is
    one `database_url` for the life of the process, but `create_app(settings=...)` is explicitly
    meant to let tests (and anything else building more than one app in-process) fully control
    what each app instance sees (see `main._app_settings`); without this, a second app instance
    with a different `database_url` would silently keep using the first one's pool.
    """
    global _pool, _pool_conninfo
    settings = settings or get_settings()
    if _pool is not None and _pool_conninfo != settings.database_url:
        close_pool()
    if _pool is None:
        _pool = ConnectionPool(conninfo=settings.database_url, min_size=1, max_size=5, open=False)
        _pool.open()
        _pool_conninfo = settings.database_url
    return _pool


def close_pool() -> None:
    """Closes and forgets the pool, if one was opened. Called on app shutdown and by tests."""
    global _pool, _pool_conninfo
    if _pool is not None:
        _pool.close()
        _pool = None
        _pool_conninfo = None


def get_conn(settings: Settings = Depends(app_settings)) -> Iterator[psycopg.Connection]:
    """FastAPI dependency: yields a pooled connection for the lifetime of one request, from the
    pool for *this app instance's* settings (not necessarily the process-wide cached one)."""
    with get_pool(settings).connection() as conn:
        yield conn
