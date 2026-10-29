"""Applies db/migrations/*.sql in name order, once each, tracked in `schema_migrations`.

Same semantics as scripts/migrate.mjs (same table, same ordering), so either one can run against
a given database without the other repeating work. Run as `python -m ujc_api.migrate`.
"""

import logging
from pathlib import Path

import psycopg

from ujc_api.settings import get_settings

log = logging.getLogger(__name__)

_CREATE_SCHEMA_MIGRATIONS = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

# apps/api/src/ujc_api/migrate.py -> repo_root/db/migrations
_DEFAULT_MIGRATIONS_DIR = Path(__file__).resolve().parents[4] / "db" / "migrations"


def migrations_dir() -> Path:
    return _DEFAULT_MIGRATIONS_DIR


def pending_migrations(conn: psycopg.Connection, directory: Path | None = None) -> list[Path]:
    """Every `*.sql` file in `directory` not yet recorded in `schema_migrations`, in name order."""
    directory = directory or migrations_dir()
    conn.execute(_CREATE_SCHEMA_MIGRATIONS)
    applied = {row[0] for row in conn.execute("SELECT name FROM schema_migrations").fetchall()}
    files = sorted(directory.glob("*.sql"), key=lambda p: p.name)
    return [f for f in files if f.name not in applied]


def apply_migrations(conn: psycopg.Connection, directory: Path | None = None) -> list[str]:
    """Applies every pending migration, one transaction each. Returns the names just applied."""
    applied_now: list[str] = []
    for file in pending_migrations(conn, directory):
        sql = file.read_text(encoding="utf-8")
        with conn.transaction():
            conn.execute(sql)
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (file.name,))
        applied_now.append(file.name)
        log.info("migrate: applied %s", file.name)
    return applied_now


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = get_settings()
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        applied = apply_migrations(conn)
    for name in applied:
        print(f"migrate: applied {name}")
    print("migrate: up to date")


if __name__ == "__main__":
    main()
