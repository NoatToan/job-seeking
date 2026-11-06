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
    assert row["score"] == 0 and row["my_vote"] == 0 and row["comment_count"] == 0
    assert row["comments_locked"] is False
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
    assert row is not None and row["score"] == 2 and row["my_vote"] == 1
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


def test_anonymous_items(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    before_mine, before_all = repo.count_recent_anonymous("key-a")
    item_id = repo.create(
        None, _req(authorName="Minh"), user_agent=None, screenshot=None, anon_key="key-a"
    )
    repo.create(None, _req(), user_agent=None, screenshot=None, anon_key="key-b")
    assert repo.count_recent_anonymous("key-a") == (before_mine + 1, before_all + 2)
    row = repo.get(item_id, None)
    assert row is not None
    assert row["author_id"] is None and row["author_email"] is None
    assert row["author_name"] == "Minh"
    assert row["my_vote"] == 0
    # Anonymous rows never show up as anyone's "mine".
    mine, _ = repo.list_items(
        viewer_id=2, scope="mine", kind=None, status=None, q=None, sort="new", limit=50, offset=0
    )
    assert item_id not in [r["id"] for r in mine]
    # A signed-in row never stores the anonymous fields, even if a name was sent.
    signed = repo.create(2, _req(authorName="Ignored"), user_agent=None, screenshot=None)
    row = repo.get(signed, 2)
    assert row is not None and row["author_name"] is None


def test_anonymous_constraints(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    with pytest.raises(ValueError):
        repo.create(None, _req(), user_agent=None, screenshot=None)
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO feedback_items (kind, title, author_id, anon_key)"
            " VALUES ('idea', 'abc', 2, 'k')"
        )
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("INSERT INTO feedback_items (kind, title) VALUES ('idea', 'abc')")


def test_public_counts_and_signed_out_board(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    before = repo.public_counts()
    assert set(before) == {"new", "under_review", "approved", "planned", "done"}
    ids = {}
    for status in ("new", "under_review", "approved", "planned", "planned", "done", "rejected"):
        item_id = repo.create(2, _req(title=f"Count {status}"), user_agent=None, screenshot=None)
        if status != "new":
            repo.update(item_id, {"status": status}, actor_id=1)
        ids[status] = item_id
    repo.vote(ids["done"], 3)
    after = repo.public_counts()
    assert after == {
        "new": before["new"] + 1,
        "under_review": before["under_review"] + 1,
        "approved": before["approved"] + 1,
        "planned": before["planned"] + 2,
        "done": before["done"] + 1,
    }
    # A signed-out viewer (`viewer_id` None) lists the board; nothing is "voted".
    rows, total = repo.list_items(
        viewer_id=None,
        scope="board",
        kind=None,
        status="done",
        q="Count",
        sort="top",
        limit=50,
        offset=0,
    )
    assert total == 1
    assert rows[0]["id"] == ids["done"]
    assert rows[0]["score"] == 1
    assert rows[0]["my_vote"] == 0


# --- votes, comments, identities, reports (sql/003) ------------------------------------------


def _comment(repo: PgFeedbackRepository, item_id: int, body: str, **kw) -> int:
    args = {
        "parent_id": None,
        "author_id": 3,
        "visitor_key": None,
        "anon_key": None,
        "by_team": False,
        **kw,
    }
    return repo.create_comment(item_id, body=body, **args)


def test_up_and_down_votes_and_score_sort(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    low = repo.create(2, _req(title="Score low"), user_agent=None, screenshot=None)
    high = repo.create(2, _req(title="Score high"), user_agent=None, screenshot=None)
    repo.vote(low, 1, -1)
    repo.vote(low, 3, -1)
    repo.vote(high, 3, 1)
    repo.vote(high, 3, -1)  # switch
    repo.vote(high, 3, 1)  # and back
    repo.vote(high, 1, 1)
    row = repo.get(low, 3)
    assert row is not None
    assert (row["score"], row["upvotes"], row["downvotes"], row["my_vote"]) == (-2, 0, 2, -1)
    rows, _ = repo.list_items(
        viewer_id=3,
        scope="board",
        kind=None,
        status=None,
        q="Score",
        sort="top",
        limit=10,
        offset=0,
    )
    assert [r["id"] for r in rows] == [high, low]
    with pytest.raises(ValueError):
        repo.vote(high, 3, 0)
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO feedback_votes (item_id, user_id, value) VALUES (%s, 2, 2)", (low,)
        )


def test_identities(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    assert repo.display_name(user_id=2) is None
    repo.set_display_name(user_id=2, name="Bee")
    repo.set_display_name(user_id=2, name="Bea")
    repo.set_display_name(visitor_key="vk-1", name="Minh")
    assert repo.display_name(user_id=2) == "Bea"
    assert repo.display_name(visitor_key="vk-1") == "Minh"
    repo.set_display_name(visitor_key="vk-1", name=None)
    assert repo.display_name(visitor_key="vk-1") is None
    with pytest.raises(ValueError):
        repo.display_name()
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    row = repo.get(item_id, None)
    assert row is not None and row["author_display_name"] == "Bea"
    repo.set_display_name(user_id=2, name=None)


def test_comment_threads(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    other_item = repo.create(2, _req(), user_agent=None, screenshot=None)
    first = _comment(repo, item_id, "first")
    second = _comment(repo, item_id, "second", author_id=None, visitor_key="vk-a", anon_key="ip-a")
    replies = [
        _comment(repo, item_id, f"reply {n}", parent_id=first, author_id=1, by_team=True)
        for n in range(5)
    ]
    repo.vote_comment(first, 1, 1)
    repo.vote_comment(first, 2, 1)
    repo.vote_comment(second, 1, -1)

    rows, total, preview = repo.list_comments(
        item_id, viewer_id=1, include_hidden=False, limit=10, offset=0, replies_preview=3
    )
    assert total == 2
    assert [r["id"] for r in rows] == [first, second]
    assert rows[0]["score"] == 2 and rows[0]["my_vote"] == 1 and rows[0]["reply_count"] == 5
    assert rows[1]["visitor_key"] == "vk-a" and rows[1]["author_email"] is None
    assert [r["id"] for r in preview] == replies[:3]
    assert all(r["by_team"] for r in preview)
    more, more_total = repo.list_replies(
        item_id, first, viewer_id=None, include_hidden=False, limit=10, offset=3
    )
    assert more_total == 5 and [r["id"] for r in more] == replies[3:]

    row = repo.get(item_id, None)
    assert row is not None and row["comment_count"] == 7

    # A parent from another item is refused by the composite foreign key.
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _comment(repo, other_item, "cross-item", parent_id=first)

    # Hidden: gone for everyone else, kept for admins, out of the count.
    repo.set_comment_hidden(second, True, actor_id=1)
    rows, total, _ = repo.list_comments(
        item_id, viewer_id=3, include_hidden=False, limit=10, offset=0, replies_preview=0
    )
    assert [r["id"] for r in rows] == [first]
    rows, _, _ = repo.list_comments(
        item_id, viewer_id=1, include_hidden=True, limit=10, offset=0, replies_preview=0
    )
    assert second in [r["id"] for r in rows]
    repo.set_comment_hidden(second, False, actor_id=1)

    # Soft delete while replies exist; hard delete afterwards cleans up the placeholder.
    assert repo.delete_comment(first) == "soft"
    gone = repo.get_comment(item_id, first, None)
    assert gone is not None and gone["deleted_at"] is not None and gone["body"] == ""
    assert gone["score"] == 0  # votes went with the words
    rows, _, _ = repo.list_comments(
        item_id, viewer_id=None, include_hidden=False, limit=10, offset=0, replies_preview=0
    )
    assert first in [r["id"] for r in rows]
    for reply in replies:
        assert repo.delete_comment(reply) == "hard"
    assert repo.get_comment(item_id, first, None) is None
    assert repo.delete_comment(second) == "hard"


def test_comment_rate_limit_counts(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    before = repo.count_recent_comments_by_author(3)
    mine, ip, everyone = repo.count_recent_anonymous_comments("vk-r", "ip-r")
    _comment(repo, item_id, "x")
    _comment(repo, item_id, "y", author_id=None, visitor_key="vk-r", anon_key="ip-r")
    _comment(repo, item_id, "z", author_id=None, visitor_key="vk-s", anon_key="ip-r")
    assert repo.count_recent_comments_by_author(3) == before + 1
    assert repo.count_recent_anonymous_comments("vk-r", "ip-r") == (
        mine + 1,
        ip + 2,
        everyone + 2,
    )
    with pytest.raises(ValueError):
        _comment(repo, item_id, "both", visitor_key="vk")
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "INSERT INTO feedback_comments (item_id, body, author_id) VALUES (%s, '', 3)",
            (item_id,),
        )


def test_reports_queue(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    item_id = repo.create(2, _req(title="Reported item"), user_agent=None, screenshot=None)
    bad = _comment(repo, item_id, "spam")
    assert repo.report_comment(bad, reporter_id=1, reporter_visitor_key=None, reason="Spam")
    assert not repo.report_comment(bad, reporter_id=1, reporter_visitor_key=None, reason="x")
    before = repo.count_recent_anonymous_reports()
    assert repo.report_comment(bad, reporter_id=None, reporter_visitor_key="vk-q", reason=None)
    assert repo.count_recent_anonymous_reports() == before + 1
    rows, total = repo.reported_comments(limit=10, offset=0)
    entry = next(r for r in rows if r["id"] == bad)
    assert total >= 1
    assert entry["report_count"] == 2 and entry["reasons"] == ["Spam"]
    assert entry["item_title"] == "Reported item" and entry["last_reported_at"] is not None
    assert repo.dismiss_reports(bad) == 2
    rows, _ = repo.reported_comments(limit=10, offset=0)
    assert bad not in [r["id"] for r in rows]


def test_account_deletion_leaves_a_tombstone(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    conn.execute("INSERT INTO users (id, email) VALUES (98, 'leaving@x.test')")
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    top = _comment(repo, item_id, "my words", author_id=98)
    reply = _comment(repo, item_id, "someone else's reply", parent_id=top)
    repo.vote_comment(reply, 98, 1)
    repo.set_display_name(user_id=98, name="Leaver")
    conn.execute("DELETE FROM users WHERE id = 98")
    row = repo.get_comment(item_id, top, None)
    assert row is not None
    assert row["author_id"] is None and row["body"] == "" and row["deleted_at"] is not None
    kept = repo.get_comment(item_id, reply, None)
    assert kept is not None and kept["body"] == "someone else's reply" and kept["score"] == 0
    left = conn.execute("SELECT count(*) FROM feedback_identities WHERE user_id = 98").fetchone()
    assert left == (0,)


def _stored(conn: psycopg.Connection, table: str, row_id: int) -> tuple:
    row = conn.execute(
        f"SELECT score, upvotes, downvotes FROM {table} WHERE id = %s", (row_id,)
    ).fetchone()
    assert row is not None
    return tuple(row)


def test_triggers_keep_stored_scores_and_comment_counts(conn: psycopg.Connection):
    repo = PgFeedbackRepository(conn)
    conn.execute("INSERT INTO users (id, email) VALUES (97, 'voter-gone@x.test')")
    item_id = repo.create(2, _req(), user_agent=None, screenshot=None)
    repo.vote(item_id, 1, 1)
    repo.vote(item_id, 3, -1)
    repo.vote(item_id, 97, 1)
    assert _stored(conn, "feedback_items", item_id) == (1, 2, 1)
    repo.vote(item_id, 3, 1)  # switch
    assert _stored(conn, "feedback_items", item_id) == (3, 3, 0)
    repo.unvote(item_id, 1)
    conn.execute("DELETE FROM users WHERE id = 97")  # cascaded vote delete
    assert _stored(conn, "feedback_items", item_id) == (1, 1, 0)

    c1 = _comment(repo, item_id, "one")
    c2 = _comment(repo, item_id, "two", parent_id=c1)
    _comment(repo, item_id, "three")
    repo.vote_comment(c1, 1, -1)
    repo.vote_comment(c1, 2, -1)
    assert _stored(conn, "feedback_comments", c1) == (-2, 0, 2)

    def count() -> int:
        row = repo.get(item_id, None)
        assert row is not None
        return row["comment_count"]

    assert count() == 3
    repo.set_comment_hidden(c2, True, actor_id=1)
    assert count() == 2
    repo.set_comment_hidden(c2, False, actor_id=1)
    assert repo.delete_comment(c1) == "soft"
    assert count() == 2
    assert _stored(conn, "feedback_comments", c1) == (0, 0, 0)
    # Deleting the item takes its comments and votes with it, without tripping the triggers.
    assert repo.delete(item_id) is True


def test_keyset_pages(conn: psycopg.Connection):
    from contributor_box.repository import sort_key

    repo = PgFeedbackRepository(conn)
    ids = [
        repo.create(2, _req(title=f"Keyset item {n}"), user_agent=None, screenshot=None)
        for n in range(5)
    ]
    repo.vote(ids[3], 1, 1)
    for sort in ("top", "new"):
        seen: list[int] = []
        after = None
        while True:
            rows, total = repo.list_items(
                viewer_id=None,
                scope="board",
                kind=None,
                status=None,
                q="Keyset item",
                sort=sort,
                limit=2,
                offset=0,
                after=after,
                with_total=after is None,
            )
            assert (total == 5) if after is None else (total is None)
            seen += [r["id"] for r in rows]
            if len(rows) < 2:
                break
            after = sort_key(rows[-1], sort)
        assert sorted(seen) == sorted(ids) and len(seen) == 5
        assert seen[0] == (ids[3] if sort == "top" else ids[-1])


def test_board_sort_uses_the_score_index(conn: psycopg.Connection):
    conn.execute("SET enable_seqscan = off")
    try:
        plan = conn.execute(
            "EXPLAIN SELECT id FROM feedback_items WHERE status = 'new'"
            " ORDER BY score DESC, created_at DESC, id DESC LIMIT 20"
        ).fetchall()
        assert "feedback_items_status_score_idx" in " ".join(r[0] for r in plan)
        plan = conn.execute(
            "EXPLAIN SELECT id FROM feedback_comments WHERE item_id = 1 AND parent_id IS NULL"
            " ORDER BY score DESC, created_at DESC, id DESC LIMIT 20"
        ).fetchall()
        assert "feedback_comments_top_idx" in " ".join(r[0] for r in plan)
    finally:
        conn.execute("RESET enable_seqscan")


def test_vote_migration_backfills_existing_votes_as_upvotes():
    """003 on a database that already has 001/002 data: every old vote becomes +1."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or not SQL_DIR.is_dir():
        pytest.skip("needs TEST_DATABASE_URL and sql/")
    schema = f"cb_mig_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{schema}"')
    try:
        scoped = make_conninfo(url, options=f"-c search_path={schema}")
        with psycopg.connect(scoped, autocommit=True) as c:
            c.execute("CREATE TABLE users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL)")
            c.execute("INSERT INTO users (email) VALUES ('a@x.test'), ('b@x.test')")
            files = sorted(SQL_DIR.glob("*.sql"))
            for f in files[:2]:
                c.execute(f.read_text())
            c.execute(
                "INSERT INTO feedback_items (kind, title, author_id, status)"
                " VALUES ('idea', 'Old idea', 1, 'approved')"
            )
            c.execute("INSERT INTO feedback_votes (item_id, user_id) VALUES (1, 1), (1, 2)")
            for f in files[2:]:
                c.execute(f.read_text())
            values = c.execute("SELECT value FROM feedback_votes ORDER BY user_id").fetchall()
            assert values == [(1,), (1,)]
            row = PgFeedbackRepository(c).get(1, 2)
            assert row is not None and row["score"] == 2 and row["my_vote"] == 1
            # New rows must state their value.
            with pytest.raises(psycopg.errors.NotNullViolation):
                c.execute("INSERT INTO users (email) VALUES ('c@x.test')")
                c.execute("INSERT INTO feedback_votes (item_id, user_id) VALUES (1, 3)")
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(f'DROP SCHEMA "{schema}" CASCADE')
