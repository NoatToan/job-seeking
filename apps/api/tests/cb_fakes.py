"""In-memory `FeedbackRepository` and a test app wired with fake host dependencies, so the
router's authorisation and validation rules are tested without a database.

Named `cb_*` (not `fakes.py`/`conftest.py`) so the file can be vendored next to a host's own test
helpers without a name clash.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import count
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from contributor_box.constants import PUBLIC_STATUSES
from contributor_box.router import (
    FeedbackDeps,
    anonymous_key_dependency,
    create_feedback_router,
)
from contributor_box.schemas import CreateItemRequest
from contributor_box.screenshot import Screenshot

CSRF = "test-csrf"


@dataclass(frozen=True)
class FakeUser:
    id: int
    email: str


class InMemoryFeedbackRepository:
    def __init__(self) -> None:
        self.items: dict[int, dict[str, Any]] = {}
        self.notes_by_item: dict[int, list[dict[str, Any]]] = {}
        self.votes: set[tuple[int, int]] = set()
        self.shots: dict[int, tuple[str, bytes]] = {}
        self._ids = count(1)
        self._note_ids = count(1)

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
    ):
        anonymous = author_id is None
        if anonymous and not anon_key:
            raise ValueError("an anonymous item needs an anon_key")
        item_id = next(self._ids)
        now = datetime.now(UTC)
        self.items[item_id] = {
            "id": item_id,
            "kind": req.kind,
            "title": req.title,
            "body": req.body,
            "status": "new",
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
            "author_name": req.author_name if anonymous else None,
            "anon_key": anon_key if anonymous else None,
            "reviewed_by": None,
            "status_changed_at": None,
            "created_at": now,
            "updated_at": now,
        }
        if screenshot is not None:
            self.shots[item_id] = (screenshot.mime, screenshot.data)
        return item_id

    def _row(self, item_id: int, viewer_id: int) -> dict[str, Any]:
        row = dict(self.items[item_id])
        row["vote_count"] = sum(1 for i, _ in self.votes if i == item_id)
        row["voted"] = (item_id, viewer_id) in self.votes
        row["has_screenshot"] = item_id in self.shots
        return row

    def list_items(self, *, viewer_id, scope, kind, status, q, sort, limit, offset):
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
        rows.sort(key=lambda r: r["id"], reverse=True)
        if sort == "top":
            rows.sort(key=lambda r: r["vote_count"], reverse=True)
        return rows[offset : offset + limit], len(rows)

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

    def vote(self, item_id, user_id):
        self.votes.add((item_id, user_id))

    def unvote(self, item_id, user_id):
        self.votes.discard((item_id, user_id))

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
            "created_at": datetime.now(UTC),
        }
        self.notes_by_item.setdefault(item_id, []).append(note)
        return note

    def update(self, item_id, fields, *, actor_id):
        item = self.items[item_id]
        old = item["status"]
        item.update(fields)
        if "status" in fields and fields["status"] != old:
            item["reviewed_by"] = actor_id
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
        return self.items.pop(item_id, None) is not None


def build_app(
    repo: InMemoryFeedbackRepository,
    admin_ids: frozenset[int] = frozenset({1}),
    *,
    allow_anonymous: bool = False,
    public_board: bool = False,
) -> FastAPI:
    """Users are picked with an `X-User` header (absent = anonymous -> 401). User 1 is an admin.

    With `allow_anonymous`, anonymous callers may create items; their rate-limit key comes from
    `X-Forwarded-For` (via `anonymous_key_dependency`). With `public_board`, anonymous callers may
    read the public board."""

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
            ),
            allow_anonymous=allow_anonymous,
            public_board=public_board,
        )
    )
    return app


def as_user(client: TestClient, user_id: int, *, csrf: bool = True) -> dict[str, str]:
    headers = {"X-User": str(user_id)}
    if csrf:
        headers["X-CSRF-Token"] = CSRF
    return headers
