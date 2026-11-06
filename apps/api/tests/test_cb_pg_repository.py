"""`PgFeedbackRepository` against a real Postgres (throwaway schema). Skipped unless
`TEST_DATABASE_URL` is set. Creates a minimal host `users` table, then applies `sql/*.sql`.

In a vendored copy inside a host there is no `sql/` next to the tests, so this module skips there;
the host's own DB-backed tests cover the repository against the host schema instead.
"""

import base64
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

from contributor_box.repository import PgFeedbackRepository, escape_like
from contributor_box.schemas import CreateItemRequest
from contributor_box.screenshot import decode_screenshot

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"
JPEG = b"\xff\xd8\xff\xe0" + b"\x01" * 32


@pytest.fixture(scope="module")
def conn() -> Iterator[psycopg.Connection]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set; skipping Postgres repository tests")
    if not SQL_DIR.is_dir():
        pytest.skip("sql/ not found next to this test (vendored copy); the host covers this")
    schema = f"cb_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
    scoped = make_conninfo(url, options=f"-c search_path={schema}")
    try:
        with psycopg.connect(scoped, autocommit=True) as c:
            c.execute("CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL)")
            c.execute("INSERT INTO users (email) VALUES ('a@x.test'), ('b@x.test'), ('c@x.test')")
            for f in sorted(SQL_DIR.glob("*.sql")):
                c.execute(f.read_text())
            yield c
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')


def _req(**overrides) -> CreateItemRequest:
    return CreateItemRequest.model_validate(
        {
            "kind": "idea",
            "title": "Dark mode please",
            "body": "100% of my evenings",
            "pageUrl": "/tracker/",
            "region": {"x": 1, "y": 2, "width": 3, "height": 4},
            "screenshotWidth": 1280,
            "screenshotHeight": 800,
            **overrides,
        }
    )


def test_full_lifecycle(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    shot = decode_screenshot("data:image/jpeg;base64," + base64.b64encode(JPEG).decode())
    item_id = repo.create(2, _req(), user_agent="UA", screenshot=shot)
    assert repo.count_recent_by_author(2) == 1

    row = repo.get(item_id, viewer_id=3)
    assert row is not None
    assert row["status"] == "new"
    assert row["author_email"] == "b@x.test"
    assert row["region"] == {"x": 1, "y": 2, "width": 3, "height": 4}
    assert row["has_screenshot"] is True
    assert row["vote_count"] == 0
    assert repo.screenshot(item_id) == ("image/jpeg", JPEG)

    repo.update(item_id, {"status": "approved", "admin_response": "Yes"}, actor_id=1)
    repo.update(item_id, {"title": "Dark mode"}, actor_id=1)  # no status change, no history row
    repo.add_note(item_id, 1, "internal", "internal")
    repo.add_note(item_id, 1, "public", "public")
    public = repo.notes(item_id, include_internal=False)
    every = repo.notes(item_id, include_internal=True)
    assert [n["kind"] for n in public] == ["status", "note"]
    assert public[0]["from_status"] == "new" and public[0]["to_status"] == "approved"
    assert len(every) == 3

    repo.vote(item_id, 3)
    repo.vote(item_id, 3)
    repo.vote(item_id, 1)
    row = repo.get(item_id, viewer_id=3)
    assert row is not None and row["vote_count"] == 2 and row["voted"] is True
    assert row["title"] == "Dark mode" and row["reviewed_by"] == 1
    repo.update(item_id, {"title": "Dark mode!"}, actor_id=2)  # an edit does not change reviewer
    row = repo.get(item_id, viewer_id=3)
    assert row is not None and row["reviewed_by"] == 1
    assert row["status_changed_at"] is not None

    board, total = repo.list_items(
        viewer_id=3, scope="board", kind=None, status=None, q="100%", sort="top", limit=10, offset=0
    )
    assert total == 1 and board[0]["id"] == item_id
    none, total = repo.list_items(
        viewer_id=3, scope="mine", kind=None, status=None, q=None, sort="new", limit=10, offset=0
    )
    assert total == 0 and none == []

    note_id = int(every[1]["id"])
    assert repo.delete_note(item_id, note_id) is True
    assert repo.delete_note(item_id, int(every[0]["id"])) is False  # status history is kept
    assert repo.delete(item_id) is True
    assert repo.get(item_id, 3) is None
    assert repo.screenshot(item_id) is None


def test_account_deletion_cascades(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    conn.execute("INSERT INTO users (id, email) VALUES (99, 'gone@x.test')")
    item_id = repo.create(99, _req(), user_agent=None, screenshot=None)
    repo.update(item_id, {"status": "approved"}, actor_id=1)
    repo.vote(item_id, 2)
    conn.execute("DELETE FROM users WHERE id = 99")
    assert repo.get(item_id, 2) is None
    left = conn.execute("SELECT count(*) FROM feedback_votes WHERE item_id = %s", (item_id,))
    assert left.fetchone() == (0,)


def test_check_constraints_back_up_validation(conn: psycopg.Connection):
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO feedback_items (kind, title, author_id) VALUES ('praise', 'abc', 1)"
        )


def test_update_rejects_unknown_fields(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    with pytest.raises(ValueError):
        repo.update(item_id, {"author_id": 3}, actor_id=1)


def test_escape_like():
    assert escape_like("50%_a\\b") == "50\\%\\_a\\\\b"
