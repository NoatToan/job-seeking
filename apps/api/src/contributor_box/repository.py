"""Data access. `FeedbackRepository` is the interface the router depends on; `PgFeedbackRepository`
is the Postgres (psycopg 3) implementation. Plain SQL, every value bound as a parameter.

The repository does no authorisation: the router decides who may call what (see `policy.py`).
"""

from datetime import datetime
from typing import Any, Literal, Protocol

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from contributor_box.constants import PUBLIC_STATUSES
from contributor_box.schemas import CreateItemRequest
from contributor_box.screenshot import Screenshot

Scope = Literal["board", "mine", "all"]
Sort = Literal["new", "top"]
DeleteResult = Literal["soft", "hard"]

Row = dict[str, Any]


class FeedbackRepository(Protocol):
    def count_recent_by_author(self, author_id: int) -> int: ...

    def count_recent_anonymous(self, anon_key: str) -> tuple[int, int]:
        """(items from this anonymous key, items from all anonymous visitors) in the last hour."""
        ...

    def create(
        self,
        author_id: int | None,
        req: CreateItemRequest,
        *,
        user_agent: str | None,
        screenshot: Screenshot | None,
        anon_key: str | None = None,
        visitor_key: str | None = None,
    ) -> int: ...

    def list_items(
        self,
        *,
        viewer_id: int | None,
        scope: Scope,
        kind: str | None,
        status: str | None,
        q: str | None,
        sort: Sort,
        limit: int,
        offset: int,
        after: tuple[Any, ...] | None = None,
        with_total: bool = True,
    ) -> tuple[list[Row], int | None]:
        """A page of items. `after` is the keyset of the last row already shown (`sort_key`),
        used instead of `offset` for "load more". The total is counted only with `with_total`
        (the first page), else `None`."""
        ...

    def get(self, item_id: int, viewer_id: int | None) -> Row | None: ...

    def public_counts(self) -> dict[str, int]:
        """Number of items in each public status (every public status present, 0 if none)."""
        ...

    def notes(self, item_id: int, *, include_internal: bool) -> list[Row]: ...

    def screenshot(self, item_id: int) -> tuple[str, bytes] | None: ...

    def vote(self, item_id: int, user_id: int, value: int = 1) -> None:
        """Sets this user's vote (+1 / -1), replacing an earlier one."""
        ...

    def unvote(self, item_id: int, user_id: int) -> None: ...

    def update(self, item_id: int, fields: dict[str, Any], *, actor_id: int) -> None: ...

    def add_note(self, item_id: int, author_id: int, body: str, visibility: str) -> Row: ...

    def delete_note(self, item_id: int, note_id: int) -> bool: ...

    def delete(self, item_id: int) -> bool: ...

    # --- identities ---

    def display_name(
        self, *, user_id: int | None = None, visitor_key: str | None = None
    ) -> str | None: ...

    def set_display_name(
        self, *, user_id: int | None = None, visitor_key: str | None = None, name: str | None
    ) -> None:
        """Stores (or with `None` removes) the chosen display name of one user or visitor."""
        ...

    # --- comments ---

    def count_recent_comments_by_author(self, author_id: int) -> int: ...

    def count_recent_anonymous_comments(
        self, visitor_key: str, anon_key: str
    ) -> tuple[int, int, int]:
        """(by this visitor, by this IP key, by all anonymous visitors) in the last hour."""
        ...

    def create_comment(
        self,
        item_id: int,
        *,
        parent_id: int | None,
        body: str,
        author_id: int | None,
        visitor_key: str | None,
        anon_key: str | None,
        by_team: bool,
    ) -> int: ...

    def get_comment(self, item_id: int, comment_id: int, viewer_id: int | None) -> Row | None: ...

    def list_comments(
        self,
        item_id: int,
        *,
        viewer_id: int | None,
        include_hidden: bool,
        limit: int,
        offset: int,
        replies_preview: int,
    ) -> tuple[list[Row], int, list[Row]]:
        """Top-level comments (score, then newest), their total, and up to `replies_preview`
        replies of each (oldest first). Deleted (and, unless `include_hidden`, hidden) comments
        are left out, except top-level ones that still have visible replies. Top-level rows carry
        `reply_count` (visible replies)."""
        ...

    def list_replies(
        self,
        item_id: int,
        parent_id: int,
        *,
        viewer_id: int | None,
        include_hidden: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[Row], int]: ...

    def edit_comment(self, comment_id: int, body: str) -> None: ...

    def delete_comment(self, comment_id: int) -> DeleteResult:
        """Hard delete, or a soft delete ("[deleted]", body cleared) while replies hang off it."""
        ...

    def set_comment_hidden(self, comment_id: int, hidden: bool, *, actor_id: int) -> None: ...

    def vote_comment(self, comment_id: int, user_id: int, value: int) -> None: ...

    def unvote_comment(self, comment_id: int, user_id: int) -> None: ...

    def count_recent_anonymous_reports(self) -> int: ...

    def report_comment(
        self,
        comment_id: int,
        *,
        reporter_id: int | None,
        reporter_visitor_key: str | None,
        reason: str | None,
    ) -> bool:
        """True if this reporter had not reported the comment yet."""
        ...

    def reported_comments(self, *, limit: int, offset: int) -> tuple[list[Row], int]:
        """Comments with reports that are neither deleted nor hidden, most reported first. Rows
        also carry `item_title`, `item_status`, `last_reported_at` and `reasons` (up to 5)."""
        ...

    def dismiss_reports(self, comment_id: int) -> int: ...


_ITEM_COLUMNS = """
  i.id, i.kind, i.title, i.body, i.status, i.page_url, i.page_title, i.element_selector,
  i.element_text, i.region, i.viewport_width, i.viewport_height, i.user_agent, i.admin_response,
  i.author_id, u.email AS author_email, fu.display_name AS author_display_name, i.author_name,
  i.visitor_key, fv.display_name AS visitor_display_name, i.reviewed_by, i.status_changed_at,
  i.created_at, i.updated_at, i.comments_locked,
  i.score, i.upvotes, i.downvotes, COALESCE(mv.value, 0)::int AS my_vote, i.comment_count,
  EXISTS (SELECT 1 FROM feedback_screenshots s WHERE s.item_id = i.id) AS has_screenshot
"""

# Score and comment count are stored on the row (kept by triggers, sql/003). The viewer's own
# vote is one primary-key lookup; `%(viewer)s` NULL (signed out) matches nothing, so 0.
_ITEM_FROM = """
  feedback_items i
  LEFT JOIN users u ON u.id = i.author_id
  LEFT JOIN feedback_identities fu ON fu.user_id = i.author_id
  LEFT JOIN feedback_identities fv ON fv.visitor_key = i.visitor_key
  LEFT JOIN feedback_votes mv ON mv.item_id = i.id AND mv.user_id = %(viewer)s
"""

_COMMENT_COLUMNS = """
  c.id, c.item_id, c.parent_id, c.author_id, u.email AS author_email,
  fu.display_name AS user_display_name, c.visitor_key, fv.display_name AS visitor_display_name,
  c.by_team, c.body, c.created_at, c.edited_at, c.deleted_at, c.hidden_at,
  c.score, c.upvotes, c.downvotes, COALESCE(mcv.value, 0)::int AS my_vote,
  CASE WHEN %(with_reports)s THEN
    (SELECT count(*) FROM feedback_comment_reports rp WHERE rp.comment_id = c.id)::int
  END AS report_count
"""

_COMMENT_FROM = """
  feedback_comments c
  LEFT JOIN users u ON u.id = c.author_id
  LEFT JOIN feedback_identities fu ON fu.user_id = c.author_id
  LEFT JOIN feedback_identities fv ON fv.visitor_key = c.visitor_key
  LEFT JOIN feedback_comment_votes mcv ON mcv.comment_id = c.id AND mcv.user_id = %(viewer)s
"""


def _visible(alias: str) -> str:
    """A comment shown as itself (not a placeholder): not deleted; hidden ones only for admins."""
    return f"{alias}.deleted_at IS NULL AND ({alias}.hidden_at IS NULL OR %(include_hidden)s)"


_REPLY_COUNT = (
    "(SELECT count(*) FROM feedback_comments r WHERE r.parent_id = c.id AND " + _visible("r") + ")"
)

_NOTE_COLUMNS = (
    "n.id, n.item_id, n.author_id, u.email AS author_email, n.kind, n.visibility, n.body,"
    " n.from_status, n.to_status, n.created_at"
)

# Columns an admin PATCH may set. Mapped explicitly so no request key ever becomes SQL.
_PATCHABLE = {
    "kind": "kind",
    "title": "title",
    "body": "body",
    "status": "status",
    "admin_response": "admin_response",
    "comments_locked": "comments_locked",
}


def escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class PgFeedbackRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def _one(self, sql: str, params: dict[str, Any] | tuple = ()) -> Row | None:
        with self._conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def _all(self, sql: str, params: dict[str, Any] | tuple = ()) -> list[Row]:
        with self._conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def _count(self, sql: str, params: dict[str, Any]) -> int:
        row = self._one(sql, params)
        return int(row["n"]) if row else 0

    def count_recent_by_author(self, author_id: int) -> int:
        # Serialise this author's submissions until the transaction ends, so two concurrent
        # requests cannot both read "under the limit" and both insert.
        self._conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('contributor_box:author:' || %s, 0))",
            (str(author_id),),
        )
        row = self._conn.execute(
            "SELECT count(*) FROM feedback_items"
            " WHERE author_id = %s AND created_at > now() - interval '1 hour'",
            (author_id,),
        ).fetchone()
        return int(row[0]) if row else 0

    def count_recent_anonymous(self, anon_key: str) -> tuple[int, int]:
        # One lock for every anonymous submission: the global cap needs it, and anonymous
        # traffic is low enough that serialising it costs nothing.
        self._conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('contributor_box:anon', 0))"
        )
        row = self._conn.execute(
            "SELECT count(*) FILTER (WHERE anon_key = %s), count(*) FROM feedback_items"
            " WHERE author_id IS NULL AND created_at > now() - interval '1 hour'",
            (anon_key,),
        ).fetchone()
        return (int(row[0]), int(row[1])) if row else (0, 0)

    def create(
        self,
        author_id: int | None,
        req: CreateItemRequest,
        *,
        user_agent: str | None,
        screenshot: Screenshot | None,
        anon_key: str | None = None,
        visitor_key: str | None = None,
    ) -> int:
        anonymous = author_id is None
        if anonymous and not anon_key:
            raise ValueError("an anonymous item needs an anon_key")
        # With a visitor identity the name lives in `feedback_identities`, not on the item.
        author_name = req.author_name if anonymous and not visitor_key else None
        row = self._conn.execute(
            "INSERT INTO feedback_items (kind, title, body, page_url, page_title,"
            " element_selector, element_text, region, viewport_width, viewport_height,"
            " user_agent, author_id, author_name, anon_key, visitor_key)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                req.kind,
                req.title,
                req.body,
                req.page_url,
                req.page_title,
                req.element_selector,
                req.element_text,
                Jsonb(req.region.model_dump()) if req.region else None,
                req.viewport_width,
                req.viewport_height,
                user_agent,
                author_id,
                author_name,
                anon_key if anonymous else None,
                visitor_key if anonymous else None,
            ),
        ).fetchone()
        assert row is not None
        item_id = int(row[0])
        if screenshot is not None:
            self._conn.execute(
                "INSERT INTO feedback_screenshots (item_id, mime, byte_size, width, height, data)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    item_id,
                    screenshot.mime,
                    len(screenshot.data),
                    req.screenshot_width,
                    req.screenshot_height,
                    screenshot.data,
                ),
            )
        return item_id

    def list_items(
        self,
        *,
        viewer_id: int | None,
        scope: Scope,
        kind: str | None,
        status: str | None,
        q: str | None,
        sort: Sort,
        limit: int,
        offset: int,
        after: tuple[Any, ...] | None = None,
        with_total: bool = True,
    ) -> tuple[list[Row], int | None]:
        where: list[str] = []
        params: dict[str, Any] = {"viewer": viewer_id, "limit": limit, "offset": offset}
        if scope == "board":
            where.append("i.status = ANY(%(public)s)")
            params["public"] = list(PUBLIC_STATUSES)
        elif scope == "mine":
            where.append("i.author_id = %(viewer)s")
        if kind:
            where.append("i.kind = %(kind)s")
            params["kind"] = kind
        if status:
            where.append("i.status = %(status)s")
            params["status"] = status
        if q:
            where.append("(i.title ILIKE %(q)s OR i.body ILIKE %(q)s)")
            params["q"] = f"%{escape_like(q)}%"
        filter_sql = f"WHERE {' AND '.join(where)}" if where else ""
        # "top" = highest score (ups - downs), like Stack Overflow; both orders match an index
        # (`feedback_items_status_score_idx`, `feedback_items_status_created_idx`).
        if sort == "top":
            order = "i.score DESC, i.created_at DESC, i.id DESC"
            keyset = "(i.score, i.created_at, i.id) < (%(k0)s, %(k1)s, %(k2)s)"
        else:
            order = "i.created_at DESC, i.id DESC"
            keyset = "(i.created_at, i.id) < (%(k0)s, %(k1)s)"
        if after is not None:
            where.append(keyset)
            params.update({f"k{n}": value for n, value in enumerate(after)})
            params["offset"] = 0
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        total = (
            self._count(f"SELECT count(*) AS n FROM feedback_items i {filter_sql}", params)
            if with_total
            else None
        )
        rows = self._all(
            f"SELECT {_ITEM_COLUMNS} FROM {_ITEM_FROM}"
            f" {where_sql} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        return rows, total

    def public_counts(self) -> dict[str, int]:
        rows = self._all(
            "SELECT status, count(*)::int AS n FROM feedback_items"
            " WHERE status = ANY(%s) GROUP BY status",
            (list(PUBLIC_STATUSES),),
        )
        counts = dict.fromkeys(PUBLIC_STATUSES, 0)
        for row in rows:
            counts[row["status"]] = int(row["n"])
        return counts

    def get(self, item_id: int, viewer_id: int | None) -> Row | None:
        return self._one(
            f"SELECT {_ITEM_COLUMNS} FROM {_ITEM_FROM} WHERE i.id = %(id)s",
            {"id": item_id, "viewer": viewer_id},
        )

    def notes(self, item_id: int, *, include_internal: bool) -> list[Row]:
        visibility = "" if include_internal else " AND n.visibility = 'public'"
        return self._all(
            f"SELECT {_NOTE_COLUMNS} FROM feedback_notes n"
            " LEFT JOIN users u ON u.id = n.author_id"
            f" WHERE n.item_id = %s{visibility} ORDER BY n.created_at, n.id",
            (item_id,),
        )

    def screenshot(self, item_id: int) -> tuple[str, bytes] | None:
        row = self._conn.execute(
            "SELECT mime, data FROM feedback_screenshots WHERE item_id = %s", (item_id,)
        ).fetchone()
        return (row[0], bytes(row[1])) if row else None

    def vote(self, item_id: int, user_id: int, value: int = 1) -> None:
        if value not in (-1, 1):
            raise ValueError("a vote is +1 or -1")
        self._conn.execute(
            "INSERT INTO feedback_votes (item_id, user_id, value) VALUES (%s, %s, %s)"
            " ON CONFLICT (item_id, user_id) DO UPDATE SET value = EXCLUDED.value,"
            " updated_at = now() WHERE feedback_votes.value <> EXCLUDED.value",
            (item_id, user_id, value),
        )

    def unvote(self, item_id: int, user_id: int) -> None:
        self._conn.execute(
            "DELETE FROM feedback_votes WHERE item_id = %s AND user_id = %s", (item_id, user_id)
        )

    def update(self, item_id: int, fields: dict[str, Any], *, actor_id: int) -> None:
        unknown = set(fields) - set(_PATCHABLE)
        if unknown:
            raise ValueError(f"not patchable: {sorted(unknown)}")
        if not fields:
            return
        new_status = fields.get("status")
        current_status: str | None = None
        if new_status is not None:
            # Lock only when the status may change: the history row must record the true
            # previous status even if two admins change it at the same time.
            row = self._conn.execute(
                "SELECT status FROM feedback_items WHERE id = %s FOR UPDATE", (item_id,)
            ).fetchone()
            if row is None:
                return
            current_status = row[0]
        sets: list[str] = ["updated_at = now()"]
        params: dict[str, Any] = {"id": item_id, "actor": actor_id}
        for key, value in fields.items():
            sets.append(f"{_PATCHABLE[key]} = %({key})s")
            params[key] = value
        status_changed = new_status is not None and new_status != current_status
        if status_changed:
            # `reviewed_by` = who last moved the item through the workflow, not who fixed a typo.
            sets.append("status_changed_at = now()")
            sets.append("reviewed_by = %(actor)s")
        self._conn.execute(f"UPDATE feedback_items SET {', '.join(sets)} WHERE id = %(id)s", params)
        if status_changed:
            self._conn.execute(
                "INSERT INTO feedback_notes"
                " (item_id, author_id, kind, visibility, body, from_status, to_status)"
                " VALUES (%s, %s, 'status', 'public', 'status changed', %s, %s)",
                (item_id, actor_id, current_status, new_status),
            )

    def add_note(self, item_id: int, author_id: int, body: str, visibility: str) -> Row:
        row = self._one(
            "WITH n AS (INSERT INTO feedback_notes (item_id, author_id, kind, visibility, body)"
            " VALUES (%s, %s, 'note', %s, %s) RETURNING *)"
            f" SELECT {_NOTE_COLUMNS} FROM n LEFT JOIN users u ON u.id = n.author_id",
            (item_id, author_id, visibility, body),
        )
        assert row is not None
        self._conn.execute("UPDATE feedback_items SET updated_at = now() WHERE id = %s", (item_id,))
        return row

    def delete_note(self, item_id: int, note_id: int) -> bool:
        cur = self._conn.execute(
            "DELETE FROM feedback_notes WHERE id = %s AND item_id = %s AND kind = 'note'",
            (note_id, item_id),
        )
        return cur.rowcount > 0

    def delete(self, item_id: int) -> bool:
        cur = self._conn.execute("DELETE FROM feedback_items WHERE id = %s", (item_id,))
        return cur.rowcount > 0

    # --- identities ------------------------------------------------------------------------------

    @staticmethod
    def _identity_column(user_id: int | None, visitor_key: str | None) -> tuple[str, Any]:
        if (user_id is None) == (visitor_key is None):
            raise ValueError("pass exactly one of user_id or visitor_key")
        return ("user_id", user_id) if user_id is not None else ("visitor_key", visitor_key)

    def display_name(
        self, *, user_id: int | None = None, visitor_key: str | None = None
    ) -> str | None:
        column, value = self._identity_column(user_id, visitor_key)
        row = self._conn.execute(
            f"SELECT display_name FROM feedback_identities WHERE {column} = %s", (value,)
        ).fetchone()
        return row[0] if row else None

    def set_display_name(
        self, *, user_id: int | None = None, visitor_key: str | None = None, name: str | None
    ) -> None:
        column, value = self._identity_column(user_id, visitor_key)
        if name is None:
            self._conn.execute(f"DELETE FROM feedback_identities WHERE {column} = %s", (value,))
            return
        self._conn.execute(
            f"INSERT INTO feedback_identities ({column}, display_name) VALUES (%s, %s)"
            f" ON CONFLICT ({column}) DO UPDATE SET display_name = EXCLUDED.display_name,"
            " updated_at = now()",
            (value, name),
        )

    # --- comments --------------------------------------------------------------------------------

    def count_recent_comments_by_author(self, author_id: int) -> int:
        self._conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('contributor_box:comment:' || %s, 0))",
            (str(author_id),),
        )
        row = self._conn.execute(
            "SELECT count(*) FROM feedback_comments"
            " WHERE author_id = %s AND created_at > now() - interval '1 hour'",
            (author_id,),
        ).fetchone()
        return int(row[0]) if row else 0

    def count_recent_anonymous_comments(
        self, visitor_key: str, anon_key: str
    ) -> tuple[int, int, int]:
        # One lock for every anonymous comment, as for anonymous items: the global cap needs it.
        self._conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended('contributor_box:anon-comment', 0))"
        )
        row = self._conn.execute(
            "SELECT count(*) FILTER (WHERE visitor_key = %s),"
            " count(*) FILTER (WHERE anon_key = %s), count(*) FROM feedback_comments"
            " WHERE visitor_key IS NOT NULL AND created_at > now() - interval '1 hour'",
            (visitor_key, anon_key),
        ).fetchone()
        return (int(row[0]), int(row[1]), int(row[2])) if row else (0, 0, 0)

    def create_comment(
        self,
        item_id: int,
        *,
        parent_id: int | None,
        body: str,
        author_id: int | None,
        visitor_key: str | None,
        anon_key: str | None,
        by_team: bool,
    ) -> int:
        if (author_id is None) == (visitor_key is None):
            raise ValueError("a comment has exactly one of author_id or visitor_key")
        row = self._conn.execute(
            "INSERT INTO feedback_comments"
            " (item_id, parent_id, body, author_id, visitor_key, anon_key, by_team)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                item_id,
                parent_id,
                body,
                author_id,
                visitor_key,
                anon_key if visitor_key else None,
                by_team,
            ),
        ).fetchone()
        assert row is not None
        return int(row[0])

    def get_comment(self, item_id: int, comment_id: int, viewer_id: int | None) -> Row | None:
        return self._one(
            f"SELECT {_COMMENT_COLUMNS}, {_REPLY_COUNT}::int AS reply_count FROM {_COMMENT_FROM}"
            " WHERE c.id = %(id)s AND c.item_id = %(item)s",
            {
                "id": comment_id,
                "item": item_id,
                "viewer": viewer_id,
                "include_hidden": False,
                "with_reports": True,
            },
        )

    def list_comments(
        self,
        item_id: int,
        *,
        viewer_id: int | None,
        include_hidden: bool,
        limit: int,
        offset: int,
        replies_preview: int,
    ) -> tuple[list[Row], int, list[Row]]:
        params: dict[str, Any] = {
            "item": item_id,
            "viewer": viewer_id,
            "include_hidden": include_hidden,
            "with_reports": include_hidden,
            "limit": limit,
            "offset": offset,
            "n": replies_preview,
        }
        where = (
            "c.item_id = %(item)s AND c.parent_id IS NULL"
            f" AND (({_visible('c')}) OR {_REPLY_COUNT} > 0)"
        )
        total = self._count(f"SELECT count(*) AS n FROM feedback_comments c WHERE {where}", params)
        rows = self._all(
            f"SELECT {_COMMENT_COLUMNS}, {_REPLY_COUNT}::int AS reply_count FROM {_COMMENT_FROM}"
            f" WHERE {where} ORDER BY c.score DESC, c.created_at DESC, c.id DESC"
            " LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        replies: list[Row] = []
        if rows and replies_preview > 0:
            params["ids"] = [r["id"] for r in rows]
            replies = self._all(
                "SELECT * FROM ("
                f" SELECT {_COMMENT_COLUMNS}, row_number() OVER"
                " (PARTITION BY c.parent_id ORDER BY c.created_at, c.id) AS rn"
                f" FROM {_COMMENT_FROM}"
                f" WHERE c.parent_id = ANY(%(ids)s) AND {_visible('c')}"
                ") s WHERE s.rn <= %(n)s ORDER BY s.created_at, s.id",
                params,
            )
        return rows, total, replies

    def list_replies(
        self,
        item_id: int,
        parent_id: int,
        *,
        viewer_id: int | None,
        include_hidden: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[Row], int]:
        params: dict[str, Any] = {
            "item": item_id,
            "parent": parent_id,
            "viewer": viewer_id,
            "include_hidden": include_hidden,
            "with_reports": include_hidden,
            "limit": limit,
            "offset": offset,
        }
        where = f"c.item_id = %(item)s AND c.parent_id = %(parent)s AND {_visible('c')}"
        total = self._count(f"SELECT count(*) AS n FROM feedback_comments c WHERE {where}", params)
        rows = self._all(
            f"SELECT {_COMMENT_COLUMNS} FROM {_COMMENT_FROM} WHERE {where}"
            " ORDER BY c.created_at, c.id LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        return rows, total

    def edit_comment(self, comment_id: int, body: str) -> None:
        self._conn.execute(
            "UPDATE feedback_comments SET body = %s, edited_at = now() WHERE id = %s",
            (body, comment_id),
        )

    def delete_comment(self, comment_id: int) -> DeleteResult:
        row = self._conn.execute(
            "SELECT parent_id, EXISTS (SELECT 1 FROM feedback_comments r"
            "  WHERE r.parent_id = c.id AND r.deleted_at IS NULL)"
            " FROM feedback_comments c WHERE c.id = %s FOR UPDATE",
            (comment_id,),
        ).fetchone()
        if row is None:
            return "hard"
        parent_id, has_replies = row
        if has_replies:
            # The words, votes and reports go; the placeholder keeps the thread together (the
            # vote trigger brings the stored score back to 0).
            self._conn.execute(
                "UPDATE feedback_comments SET deleted_at = now(), body = '' WHERE id = %s",
                (comment_id,),
            )
            self._conn.execute(
                "DELETE FROM feedback_comment_votes WHERE comment_id = %s", (comment_id,)
            )
            self._conn.execute(
                "DELETE FROM feedback_comment_reports WHERE comment_id = %s", (comment_id,)
            )
            return "soft"
        self._conn.execute("DELETE FROM feedback_comments WHERE id = %s", (comment_id,))
        if parent_id is not None:
            # The last reply under a "[deleted]" placeholder is gone: drop the placeholder too.
            self._conn.execute(
                "DELETE FROM feedback_comments p WHERE p.id = %s AND p.deleted_at IS NOT NULL"
                " AND NOT EXISTS (SELECT 1 FROM feedback_comments r"
                "  WHERE r.parent_id = p.id AND r.deleted_at IS NULL)",
                (parent_id,),
            )
        return "hard"

    def set_comment_hidden(self, comment_id: int, hidden: bool, *, actor_id: int) -> None:
        if hidden:
            self._conn.execute(
                "UPDATE feedback_comments SET hidden_at = COALESCE(hidden_at, now()),"
                " hidden_by = %s WHERE id = %s",
                (actor_id, comment_id),
            )
        else:
            self._conn.execute(
                "UPDATE feedback_comments SET hidden_at = NULL, hidden_by = NULL WHERE id = %s",
                (comment_id,),
            )

    def vote_comment(self, comment_id: int, user_id: int, value: int) -> None:
        if value not in (-1, 1):
            raise ValueError("a vote is +1 or -1")
        self._conn.execute(
            "INSERT INTO feedback_comment_votes (comment_id, user_id, value) VALUES (%s, %s, %s)"
            " ON CONFLICT (comment_id, user_id) DO UPDATE SET value = EXCLUDED.value,"
            " updated_at = now() WHERE feedback_comment_votes.value <> EXCLUDED.value",
            (comment_id, user_id, value),
        )

    def unvote_comment(self, comment_id: int, user_id: int) -> None:
        self._conn.execute(
            "DELETE FROM feedback_comment_votes WHERE comment_id = %s AND user_id = %s",
            (comment_id, user_id),
        )

    def count_recent_anonymous_reports(self) -> int:
        row = self._conn.execute(
            "SELECT count(*) FROM feedback_comment_reports"
            " WHERE reporter_visitor_key IS NOT NULL AND created_at > now() - interval '1 hour'"
        ).fetchone()
        return int(row[0]) if row else 0

    def report_comment(
        self,
        comment_id: int,
        *,
        reporter_id: int | None,
        reporter_visitor_key: str | None,
        reason: str | None,
    ) -> bool:
        if (reporter_id is None) == (reporter_visitor_key is None):
            raise ValueError("a report has exactly one of reporter_id or reporter_visitor_key")
        cur = self._conn.execute(
            "INSERT INTO feedback_comment_reports"
            " (comment_id, reporter_id, reporter_visitor_key, reason) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT DO NOTHING",
            (comment_id, reporter_id, reporter_visitor_key, reason),
        )
        return cur.rowcount > 0

    def reported_comments(self, *, limit: int, offset: int) -> tuple[list[Row], int]:
        params: dict[str, Any] = {
            "viewer": None,
            "with_reports": True,
            "limit": limit,
            "offset": offset,
        }
        where = (
            "c.deleted_at IS NULL AND c.hidden_at IS NULL"
            " AND EXISTS (SELECT 1 FROM feedback_comment_reports x WHERE x.comment_id = c.id)"
        )
        total = self._count(f"SELECT count(*) AS n FROM feedback_comments c WHERE {where}", params)
        rows = self._all(
            f"SELECT {_COMMENT_COLUMNS}, i.title AS item_title, i.status AS item_status,"
            " rr.last_reported_at, rr.reasons"
            f" FROM {_COMMENT_FROM} JOIN feedback_items i ON i.id = c.item_id"
            " JOIN LATERAL (SELECT max(x.created_at) AS last_reported_at,"
            "   (array_agg(x.reason ORDER BY x.created_at DESC)"
            "     FILTER (WHERE x.reason IS NOT NULL))[1:5] AS reasons"
            "   FROM feedback_comment_reports x WHERE x.comment_id = c.id) rr ON true"
            f" WHERE {where} ORDER BY report_count DESC, rr.last_reported_at DESC, c.id DESC"
            " LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        return rows, total

    def dismiss_reports(self, comment_id: int) -> int:
        cur = self._conn.execute(
            "DELETE FROM feedback_comment_reports WHERE comment_id = %s", (comment_id,)
        )
        return cur.rowcount


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def sort_key(row: Row, sort: Sort) -> tuple[Any, ...]:
    """The keyset of a listed row, for `list_items(after=...)`."""
    if sort == "top":
        return (int(row["score"]), row["created_at"], int(row["id"]))
    return (row["created_at"], int(row["id"]))
