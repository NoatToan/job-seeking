"""Audit log placeholder (M3-01). Logs security-relevant actions until M5-04 adds the
`audit_log` table; callers don't change when that lands."""

import logging

import psycopg

log = logging.getLogger(__name__)


def record(conn: psycopg.Connection, user_id: int, action: str, meta: dict | None = None) -> None:
    """Records `action` for `user_id` (e.g. `connection_added`, `connection_removed`). `conn` is
    unused for now (no table yet) but kept in the signature so call sites don't change once
    M5-04 adds persistence."""
    del conn
    log.info("audit: user=%s action=%s meta=%s", user_id, action, meta or {})
