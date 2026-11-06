"""In-memory `FeedbackRepository` and a test app wired with fake host dependencies, so the
router's authorisation and validation rules are tested without a database.

Named `cb_*` (not `fakes.py`/`conftest.py`) so the file can be vendored next to a host's own test
helpers without a name clash.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import count
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from contributor_box.constants import PUBLIC_STATUSES
from contributor_box.identity import VisitorCookies
from contributor_box.repository import sort_key
from contributor_box.router import (
    FeedbackDeps,
    anonymous_key_dependency,
    create_feedback_router,
)
from contributor_box.schemas import CreateItemRequest
from contributor_box.screenshot import Screenshot

CSRF = "test-csrf"
VISITOR_SECRET = "visitor-secret"


@dataclass(frozen=True)
class FakeUser:
    id: int
    email: str


def _score(votes: dict[tuple[int, int], int], target: int) -> tuple[int, int, int]:
    values = [v for (t, _), v in votes.items() if t == target]
    ups = sum(1 for v in values if v == 1)
    downs = sum(1 for v in values if v == -1)
    return ups - downs, ups, downs


class InMemoryFeedbackRepository:
    def __init__(self) -> None:
        self.items: dict[int, dict[str, Any]] = {}
        self.notes_by_item: dict[int, list[dict[str, Any]]] = {}
        # (item_id, user_id) -> +1 / -1
        self.votes: dict[tuple[int, int], int] = {}
        self.shots: dict[int, tuple[str, bytes]] = {}
        self.names: dict[tuple[str, Any], str] = {}
        self.comments: dict[int, dict[str, Any]] = {}
        # (comment_id, user_id) -> +1 / -1
        self.comment_votes: dict[tuple[int, int], int] = {}
        self.reports: list[dict[str, Any]] = []
        self._ids = count(1)
        self._note_ids = count(1)
        self._comment_ids = count(1)
        # Tests move time forward to cross the edit/delete windows.
        self.clock_offset = timedelta(0)

    def now(self) -> datetime:
        return datetime.now(UTC) + self.clock_offset

    # --- items -----------------------------------------------------------------------------------

    def count_recent_by_author(self, author_id: int) -> int:
        return sum(1 for i in self.items.values() if i["author_id"] == author_id)

    def count_recent_anonymous(self, anon_key: str) -> tuple[int, int]:
        anon = [i for i in self.items.values() if i["author_id"] is None]
        return sum(1 for i in anon if i["anon_key"] == anon_key), len(anon)

    def create(
        self,
        author_id,
        req: CreateItemRequest,
        *,
        user_agent,
        screenshot: Screenshot | None,
        anon_key: str | None = None,
        visitor_key: str | None = None,
        status: str = "new",
    ):
        anonymous = author_id is None
        if anonymous and not anon_key:
            raise ValueError("an anonymous item needs an anon_key")
        item_id = next(self._ids)
        now = self.now()
        self.items[item_id] = {
            "id": item_id,
            "kind": req.kind,
            "title": req.title,
            "body": req.body,
            "status": status,
            "page_url": req.page_url,
            "page_title": req.page_title,
            "element_selector": req.element_selector,
            "element_text": req.element_text,
            "region": req.region.model_dump() if req.region else None,
            "viewport_width": req.viewport_width,
            "viewport_height": req.viewport_height,
            "user_agent": user_agent,
            "admin_response": None,
            "author_id": author_id,
            "author_email": None if anonymous else f"user{author_id}@example.com",
            "author_name": req.author_name if anonymous and not visitor_key else None,
            "anon_key": anon_key if anonymous else None,
            "visitor_key": visitor_key if anonymous else None,
            "comments_locked": False,
            "reviewed_by": None,
            "status_changed_at": None,
            "created_at": now,
            "updated_at": now,
        }
        if screenshot is not None:
            self.shots[item_id] = (screenshot.mime, screenshot.data)
        return item_id

    def _row(self, item_id: int, viewer_id: int | None) -> dict[str, Any]:
        row = dict(self.items[item_id])
        row["score"], row["upvotes"], row["downvotes"] = _score(self.votes, item_id)
        row["my_vote"] = self.votes.get((item_id, viewer_id), 0) if viewer_id is not None else 0
        row["has_screenshot"] = item_id in self.shots
        row["author_display_name"] = self.names.get(("user", row["author_id"]))
        row["visitor_display_name"] = self.names.get(("visitor", row["visitor_key"]))
        row["comment_count"] = sum(
            1
            for c in self.comments.values()
            if c["item_id"] == item_id and c["deleted_at"] is None and c["hidden_at"] is None
        )
        return row

    def list_items(
        self,
        *,
        viewer_id,
        scope,
        kind,
        status,
        q,
        sort,
        limit,
        offset,
        after=None,
        with_total=True,
    ):
        rows, total = self._filtered(viewer_id, scope, kind, status, q, sort)
        if after is not None:
            rows = [r for r in rows if sort_key(r, sort) < tuple(after)]
            offset = 0
        return rows[offset : offset + limit], (total if with_total else None)

    def _filtered(self, viewer_id, scope, kind, status, q, sort):
        rows = [self._row(i, viewer_id) for i in self.items]
        if scope == "board":
            rows = [r for r in rows if r["status"] in PUBLIC_STATUSES]
        elif scope == "mine":
            rows = [r for r in rows if r["author_id"] == viewer_id]
        if kind:
            rows = [r for r in rows if r["kind"] == kind]
        if status:
            rows = [r for r in rows if r["status"] == status]
        if q:
            rows = [r for r in rows if q.lower() in (r["title"] + r["body"]).lower()]
        # Same order as the SQL: the keyset, descending.
        rows.sort(key=lambda r: sort_key(r, sort), reverse=True)
        return rows, len(rows)

    def public_counts(self):
        counts = dict.fromkeys(PUBLIC_STATUSES, 0)
        for item in self.items.values():
            if item["status"] in counts:
                counts[item["status"]] += 1
        return counts

    def get(self, item_id, viewer_id):
        return self._row(item_id, viewer_id) if item_id in self.items else None

    def notes(self, item_id, *, include_internal):
        notes = self.notes_by_item.get(item_id, [])
        return [n for n in notes if include_internal or n["visibility"] == "public"]

    def screenshot(self, item_id):
        return self.shots.get(item_id)

    def vote(self, item_id, user_id, value=1):
        if value not in (-1, 1):
            raise ValueError("a vote is +1 or -1")
        self.votes[(item_id, user_id)] = value

    def unvote(self, item_id, user_id):
        self.votes.pop((item_id, user_id), None)

    def _note(self, item_id, author_id, kind, visibility, body, from_status=None, to_status=None):
        note = {
            "id": next(self._note_ids),
            "item_id": item_id,
            "author_id": author_id,
            "author_email": f"user{author_id}@example.com",
            "kind": kind,
            "visibility": visibility,
            "body": body,
            "from_status": from_status,
            "to_status": to_status,
            "created_at": self.now(),
        }
        self.notes_by_item.setdefault(item_id, []).append(note)
        return note

    def update(self, item_id, fields, *, actor_id):
        item = self.items[item_id]
        old = item["status"]
        item.update(fields)
        if "status" in fields and fields["status"] != old:
            item["reviewed_by"] = actor_id
            item["status_changed_at"] = self.now()
            self._note(
                item_id, actor_id, "status", "public", "status changed", old, fields["status"]
            )

    def add_note(self, item_id, author_id, body, visibility):
        return self._note(item_id, author_id, "note", visibility, body)

    def delete_note(self, item_id, note_id):
        notes = self.notes_by_item.get(item_id, [])
        for n in notes:
            if n["id"] == note_id and n["kind"] == "note":
                notes.remove(n)
                return True
        return False

    def delete(self, item_id):
        for cid in [c["id"] for c in self.comments.values() if c["item_id"] == item_id]:
            self.comments.pop(cid, None)
        return self.items.pop(item_id, None) is not None

    # --- identities ------------------------------------------------------------------------------

    def _identity(self, user_id, visitor_key) -> tuple[str, Any]:
        if (user_id is None) == (visitor_key is None):
            raise ValueError("pass exactly one of user_id or visitor_key")
        return ("user", user_id) if user_id is not None else ("visitor", visitor_key)

    def display_name(self, *, user_id=None, visitor_key=None):
        return self.names.get(self._identity(user_id, visitor_key))

    def set_display_name(self, *, user_id=None, visitor_key=None, name):
        key = self._identity(user_id, visitor_key)
        if name is None:
            self.names.pop(key, None)
        else:
            self.names[key] = name

    # --- comments --------------------------------------------------------------------------------

    def count_recent_comments_by_author(self, author_id):
        return sum(1 for c in self.comments.values() if c["author_id"] == author_id)

    def count_recent_anonymous_comments(self, visitor_key, anon_key):
        anon = [c for c in self.comments.values() if c["visitor_key"] is not None]
        return (
            sum(1 for c in anon if c["visitor_key"] == visitor_key),
            sum(1 for c in anon if c["anon_key"] == anon_key),
            len(anon),
        )

    def create_comment(
        self, item_id, *, parent_id, body, author_id, visitor_key, anon_key, by_team
    ):
        if (author_id is None) == (visitor_key is None):
            raise ValueError("a comment has exactly one of author_id or visitor_key")
        if parent_id is not None:
            parent = self.comments[parent_id]
            assert parent["item_id"] == item_id and parent["parent_id"] is None
        cid = next(self._comment_ids)
        self.comments[cid] = {
            "id": cid,
            "item_id": item_id,
            "parent_id": parent_id,
            "author_id": author_id,
            "author_email": f"user{author_id}@example.com" if author_id else None,
            "visitor_key": visitor_key,
            "anon_key": anon_key if visitor_key else None,
            "by_team": by_team,
            "body": body,
            "created_at": self.now(),
            "edited_at": None,
            "deleted_at": None,
            "hidden_at": None,
        }
        return cid

    def _visible(self, c, include_hidden) -> bool:
        return c["deleted_at"] is None and (c["hidden_at"] is None or include_hidden)

    def _comment_row(self, c, viewer_id, include_hidden=False) -> dict[str, Any]:
        row = dict(c)
        row["score"], row["upvotes"], row["downvotes"] = _score(self.comment_votes, c["id"])
        row["my_vote"] = (
            self.comment_votes.get((c["id"], viewer_id), 0) if viewer_id is not None else 0
        )
        row["user_display_name"] = self.names.get(("user", c["author_id"]))
        row["visitor_display_name"] = self.names.get(("visitor", c["visitor_key"]))
        row["report_count"] = sum(1 for r in self.reports if r["comment_id"] == c["id"])
        row["reply_count"] = sum(
            1
            for r in self.comments.values()
            if r["parent_id"] == c["id"] and self._visible(r, include_hidden)
        )
        return row

    def get_comment(self, item_id, comment_id, viewer_id):
        c = self.comments.get(comment_id)
        if c is None or c["item_id"] != item_id:
            return None
        return self._comment_row(c, viewer_id)

    def list_comments(self, item_id, *, viewer_id, include_hidden, limit, offset, replies_preview):
        tops = [
            self._comment_row(c, viewer_id, include_hidden)
            for c in self.comments.values()
            if c["item_id"] == item_id and c["parent_id"] is None
        ]
        tops = [t for t in tops if self._visible(t, include_hidden) or t["reply_count"] > 0]
        tops.sort(key=lambda r: (r["score"], r["created_at"], r["id"]), reverse=True)
        page = tops[offset : offset + limit]
        replies: list[dict[str, Any]] = []
        for top in page:
            kids = sorted(
                (
                    self._comment_row(c, viewer_id)
                    for c in self.comments.values()
                    if c["parent_id"] == top["id"] and self._visible(c, include_hidden)
                ),
                key=lambda r: (r["created_at"], r["id"]),
            )
            replies.extend(kids[:replies_preview])
        return page, len(tops), replies

    def list_replies(self, item_id, parent_id, *, viewer_id, include_hidden, limit, offset):
        kids = sorted(
            (
                self._comment_row(c, viewer_id)
                for c in self.comments.values()
                if c["item_id"] == item_id
                and c["parent_id"] == parent_id
                and self._visible(c, include_hidden)
            ),
            key=lambda r: (r["created_at"], r["id"]),
        )
        return kids[offset : offset + limit], len(kids)

    def edit_comment(self, comment_id, body):
        self.comments[comment_id].update(body=body, edited_at=self.now())

    def delete_comment(self, comment_id):
        c = self.comments[comment_id]
        has_replies = any(
            r["parent_id"] == comment_id and r["deleted_at"] is None for r in self.comments.values()
        )
        self.comment_votes = {k: v for k, v in self.comment_votes.items() if k[0] != comment_id}
        self.reports = [r for r in self.reports if r["comment_id"] != comment_id]
        if has_replies:
            c.update(deleted_at=self.now(), body="")
            return "soft"
        for rid in [r["id"] for r in self.comments.values() if r["parent_id"] == comment_id]:
            self.comments.pop(rid)
        self.comments.pop(comment_id)
        parent = self.comments.get(c["parent_id"]) if c["parent_id"] else None
        if (
            parent is not None
            and parent["deleted_at"] is not None
            and not any(
                r["parent_id"] == parent["id"] and r["deleted_at"] is None
                for r in self.comments.values()
            )
        ):
            self.comments.pop(parent["id"])
        return "hard"

    def set_comment_hidden(self, comment_id, hidden, *, actor_id):
        self.comments[comment_id]["hidden_at"] = self.now() if hidden else None

    def vote_comment(self, comment_id, user_id, value):
        if value not in (-1, 1):
            raise ValueError("a vote is +1 or -1")
        self.comment_votes[(comment_id, user_id)] = value

    def unvote_comment(self, comment_id, user_id):
        self.comment_votes.pop((comment_id, user_id), None)

    def count_recent_anonymous_reports(self):
        return sum(1 for r in self.reports if r["reporter_visitor_key"] is not None)

    def report_comment(self, comment_id, *, reporter_id, reporter_visitor_key, reason):
        if (reporter_id is None) == (reporter_visitor_key is None):
            raise ValueError("a report has exactly one reporter")
        for r in self.reports:
            if r["comment_id"] == comment_id and (
                (reporter_id is not None and r["reporter_id"] == reporter_id)
                or (
                    reporter_visitor_key is not None
                    and r["reporter_visitor_key"] == reporter_visitor_key
                )
            ):
                return False
        self.reports.append(
            {
                "comment_id": comment_id,
                "reporter_id": reporter_id,
                "reporter_visitor_key": reporter_visitor_key,
                "reason": reason,
                "created_at": self.now(),
            }
        )
        return True

    def reported_comments(self, *, limit, offset):
        ids = {r["comment_id"] for r in self.reports}
        rows = []
        for cid in ids:
            c = self.comments.get(cid)
            if c is None or c["deleted_at"] is not None or c["hidden_at"] is not None:
                continue
            row = self._comment_row(c, None)
            mine = [r for r in self.reports if r["comment_id"] == cid]
            item = self.items[c["item_id"]]
            row.update(
                item_title=item["title"],
                item_status=item["status"],
                last_reported_at=max(r["created_at"] for r in mine),
                reasons=[r["reason"] for r in mine if r["reason"]][:5],
            )
            rows.append(row)
        rows.sort(key=lambda r: (r["report_count"], r["last_reported_at"]), reverse=True)
        return rows[offset : offset + limit], len(rows)

    def dismiss_reports(self, comment_id):
        before = len(self.reports)
        self.reports = [r for r in self.reports if r["comment_id"] != comment_id]
        return before - len(self.reports)


def build_app(
    repo: InMemoryFeedbackRepository,
    admin_ids: frozenset[int] = frozenset({1}),
    *,
    allow_anonymous: bool = False,
    public_board: bool = False,
    allow_anonymous_comments: bool = False,
    visitor_cookies: bool = True,
    initial_status: str = "new",
) -> FastAPI:
    """Users are picked with an `X-User` header (absent = anonymous -> 401). User 1 is an admin.

    With `allow_anonymous`, anonymous callers may create items; their rate-limit key comes from
    `X-Forwarded-For` (via `anonymous_key_dependency`). With `public_board`, anonymous callers may
    read the public board. With `allow_anonymous_comments`, they may comment under the pseudonym
    of the `cb_visitor` cookie (`VisitorCookies`, not `secure` so the test client sends it)."""

    def optional_user(request: Request) -> FakeUser | None:
        raw = request.headers.get("x-user")
        return FakeUser(id=int(raw), email=f"user{raw}@example.com") if raw else None

    def current_user(user: FakeUser | None = Depends(optional_user)) -> FakeUser:
        if user is None:
            raise HTTPException(401, detail={"code": "unauthorized", "message": "Sign in"})
        return user

    # Depends-based, like a real host: FastAPI resolves `current_user` once per request.
    def viewer_is_admin(user: FakeUser = Depends(current_user)) -> bool:
        return user.id in admin_ids

    def optional_viewer_is_admin(user: FakeUser | None = Depends(optional_user)) -> bool:
        return user is not None and user.id in admin_ids

    def require_csrf(request: Request) -> None:
        if request.headers.get("x-csrf-token") != CSRF:
            raise HTTPException(403, detail={"code": "csrf_failed", "message": "CSRF"})

    def cookies() -> VisitorCookies:
        return VisitorCookies(VISITOR_SECRET, secure=False)

    app = FastAPI()
    app.include_router(
        create_feedback_router(
            FeedbackDeps(
                current_user=current_user,
                viewer_is_admin=viewer_is_admin,
                get_repo=lambda: repo,
                require_csrf=require_csrf,
                optional_user=optional_user,
                optional_viewer_is_admin=optional_viewer_is_admin,
                anonymous_key=anonymous_key_dependency("test-secret"),
                visitor_cookies=cookies if visitor_cookies else None,
            ),
            allow_anonymous=allow_anonymous,
            public_board=public_board,
            allow_anonymous_comments=allow_anonymous_comments,
            initial_status=initial_status,
        )
    )
    return app


def as_user(client: TestClient, user_id: int, *, csrf: bool = True) -> dict[str, str]:
    headers = {"X-User": str(user_id)}
    if csrf:
        headers["X-CSRF-Token"] = CSRF
    return headers
