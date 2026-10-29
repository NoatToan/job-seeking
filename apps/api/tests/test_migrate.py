"""Migration-runner tests. The ordering/idempotency logic is tested against a fake connection (no
DB needed); applying the real 001-006 migrations is tested against TEST_DATABASE_URL (skipped if
that is unset).
"""

import psycopg
import pytest

from ujc_api.migrate import apply_migrations, migrations_dir, pending_migrations


class _FakeResult:
    def __init__(self, rows: list[tuple]):
        self._rows = rows

    def fetchall(self) -> list[tuple]:
        return self._rows


class _FakeTransaction:
    def __enter__(self) -> "_FakeTransaction":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False


class FakeConnection:
    """Just enough of the psycopg.Connection surface for pending_migrations/apply_migrations."""

    def __init__(self, fail_on: frozenset[str] = frozenset()):
        self.applied: list[str] = []
        self.statements: list[str] = []
        self._fail_on = fail_on

    def execute(self, sql: str, params: tuple | None = None) -> _FakeResult:
        if sql in self._fail_on:
            raise RuntimeError(f"simulated failure applying: {sql!r}")
        self.statements.append(sql)
        normalized = " ".join(sql.split()).upper()
        if normalized.startswith("SELECT NAME FROM SCHEMA_MIGRATIONS"):
            return _FakeResult([(name,) for name in self.applied])
        if normalized.startswith("INSERT INTO SCHEMA_MIGRATIONS"):
            assert params is not None
            self.applied.append(params[0])
        return _FakeResult([])

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction()


def test_pending_migrations_are_sorted_by_name(tmp_path):
    (tmp_path / "010_c.sql").write_text("-- c")
    (tmp_path / "002_b.sql").write_text("-- b")
    (tmp_path / "001_a.sql").write_text("-- a")
    pending = pending_migrations(FakeConnection(), tmp_path)
    assert [p.name for p in pending] == ["001_a.sql", "002_b.sql", "010_c.sql"]


def test_pending_migrations_excludes_already_applied(tmp_path):
    (tmp_path / "001_a.sql").write_text("-- a")
    (tmp_path / "002_b.sql").write_text("-- b")
    conn = FakeConnection()
    conn.applied.append("001_a.sql")
    pending = pending_migrations(conn, tmp_path)
    assert [p.name for p in pending] == ["002_b.sql"]


def test_apply_migrations_applies_each_pending_file_once(tmp_path):
    (tmp_path / "001_a.sql").write_text("SELECT 1;")
    (tmp_path / "002_b.sql").write_text("SELECT 1;")
    conn = FakeConnection()
    applied_now = apply_migrations(conn, tmp_path)
    assert applied_now == ["001_a.sql", "002_b.sql"]
    assert conn.applied == ["001_a.sql", "002_b.sql"]


def test_apply_migrations_is_a_no_op_on_the_second_run(tmp_path):
    (tmp_path / "001_a.sql").write_text("SELECT 1;")
    conn = FakeConnection()
    first = apply_migrations(conn, tmp_path)
    second = apply_migrations(conn, tmp_path)
    assert first == ["001_a.sql"]
    assert second == []


def test_migrations_dir_points_at_repo_root_db_migrations():
    directory = migrations_dir()
    assert directory.name == "migrations"
    assert directory.parent.name == "db"
    assert (directory / "001_init.sql").is_file()


def test_apply_migrations_001_to_006_then_no_op_on_real_db(migrated_database_url):
    """`migrated_database_url` (conftest.py) already applied every migration once; this asserts
    001-006 exist and that running again is a no-op (acceptance criterion for M1-01).
    """
    with psycopg.connect(migrated_database_url) as conn:
        applied_names = {row[0] for row in conn.execute("SELECT name FROM schema_migrations")}
        expected = {f"{n:03d}_" for n in range(1, 7)}
        assert all(any(name.startswith(prefix) for name in applied_names) for prefix in expected)

        second_run = apply_migrations(conn)
        assert second_run == []


def test_apply_migrations_does_not_record_a_failing_migration(tmp_path):
    (tmp_path / "001_bad.sql").write_text("not sql")
    conn = FakeConnection(fail_on=frozenset({"not sql"}))
    with pytest.raises(RuntimeError):
        apply_migrations(conn, tmp_path)
    assert conn.applied == []
