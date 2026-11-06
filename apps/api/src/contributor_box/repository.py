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
    ) -> tuple[list[Row], int]: ...

    def get(self, item_id: int, viewer_id: int | None) -> Row | None: ...

    def public_counts(self) -> dict[str, int]:
        """Number of items in each public status (every public status present, 0 if none)."""
        ...

    def notes(self, item_id: int, *, include_internal: bool) -> list[Row]: ...

    def screenshot(self, item_id: int) -> tuple[str, bytes] | None: ...

    def vote(self, item_id: int, user_id: int) -> None: ...

    def unvote(self, item_id: int, user_id: int) -> None: ...

    def update(self, item_id: int, fields: dict[str, Any], *, actor_id: int) -> None: ...

    def add_note(self, item_id: int, author_id: int, body: str, visibility: str) -> Row: ...

    def delete_note(self, item_id: int, note_id: int) -> bool: ...

    def delete(self, item_id: int) -> bool: ...


_ITEM_COLUMNS = """
  i.id, i.kind, i.title, i.body, i.status, i.page_url, i.page_title, i.element_selector,
  i.element_text, i.region, i.viewport_width, i.viewport_height, i.user_agent, i.admin_response,
  i.author_id, u.email AS author_email, i.author_name, i.reviewed_by, i.status_changed_at,
  i.created_at, i.updated_at,
  (SELECT count(*) FROM feedback_votes v WHERE v.item_id = i.id)::int AS vote_count,
  EXISTS (SELECT 1 FROM feedback_votes v WHERE v.item_id = i.id AND v.user_id = %(viewer)s)
    AS voted,
  EXISTS (SELECT 1 FROM feedback_screenshots s WHERE s.item_id = i.id) AS has_screenshot
"""

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
    ) -> int:
        anonymous = author_id is None
        if anonymous and not anon_key:
            raise ValueError("an anonymous item needs an anon_key")
        row = self._conn.execute(
            "INSERT INTO feedback_items (kind, title, body, page_url, page_title,"
            " element_selector, element_text, region, viewport_width, viewport_height,"
            " user_agent, author_id, author_name, anon_key)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
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
                req.author_name if anonymous else None,
                anon_key if anonymous else None,
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
    ) -> tuple[list[Row], int]:
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
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        order = (
            "vote_count DESC, i.created_at DESC, i.id DESC"
            if sort == "top"
            else "i.created_at DESC, i.id DESC"
        )
        total_row = self._one(f"SELECT count(*) AS n FROM feedback_items i {where_sql}", params)
        rows = self._all(
            f"SELECT {_ITEM_COLUMNS} FROM feedback_items i"
            " LEFT JOIN users u ON u.id = i.author_id"
            f" {where_sql} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        return rows, int(total_row["n"]) if total_row else 0

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
            f"SELECT {_ITEM_COLUMNS} FROM feedback_items i"
            " LEFT JOIN users u ON u.id = i.author_id WHERE i.id = %(id)s",
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

    def vote(self, item_id: int, user_id: int) -> None:
        self._conn.execute(
            "INSERT INTO feedback_votes (item_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (item_id, user_id),
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


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None
