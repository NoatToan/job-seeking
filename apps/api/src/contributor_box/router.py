"""FastAPI router factory. The host injects its own auth, CSRF, admin check and DB access through
`FeedbackDeps`; this module owns the endpoints, validation and authorisation rules.

Every endpoint requires a signed-in user unless the host opts in to anonymous submissions or a
public board (both below). Every admin action is checked here, server-side, with
`require_admin` (403 for a signed-in non-admin); every read goes through `policy.can_view` (404 for
an item the viewer may not see). Unsafe methods require the host's CSRF dependency.

Errors are raised as `HTTPException(status, detail={"code", "message"})`, the shape the host's
error handler turns into `{"error": {"code", "message"}}`. Request validation failures are
FastAPI's `RequestValidationError`; hosts should install a handler that reshapes it into the same
contract (job-seeking does: 400 `validation_error` with `fields`).

Dependency order on unsafe routes is auth (401), then CSRF (403), then admin (403), so an
anonymous caller always gets 401.

Anonymous submissions (opt-in, `allow_anonymous=True`): `POST <prefix>` then also accepts a caller
with no session, still behind the host's CSRF check, rate-limited per anonymous key (see
`anonymous_key_dependency`) and across all anonymous visitors. Everything else stays signed-in only.

Public board (opt-in, `public_board=True`): the read side of the public board works without a
session, for a public roadmap page: `GET <prefix>?scope=board`, `GET <prefix>/stats` and
`GET <prefix>/{id}` for a public-status item. A signed-out viewer gets public fields only (no
`voted`, `canVote` false, no context, no author, public notes only) and gets 401 for `scope=mine`
or `scope=all`. Voting, screenshots, "my feedback" and every admin action stay signed-in only. The
two flags are independent: a host can show the board publicly without accepting anonymous
submissions, or the other way round.
"""

import hashlib
import hmac
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response

from contributor_box import policy
from contributor_box.constants import (
    KINDS,
    LIST_LIMIT_DEFAULT,
    LIST_LIMIT_MAX,
    MAX_ANON_ITEMS_PER_HOUR,
    MAX_ANON_ITEMS_PER_HOUR_TOTAL,
    MAX_ITEMS_PER_HOUR,
    PUBLIC_STATUSES,
    STATUSES,
)
from contributor_box.dto import item_dto, note_dto
from contributor_box.repository import FeedbackRepository
from contributor_box.schemas import (
    AdminPatchRequest,
    CreateItemRequest,
    NoteRequest,
    clip_user_agent,
)
from contributor_box.screenshot import ScreenshotError, decode_screenshot

_MAX_ID = 9_223_372_036_854_775_807


@dataclass(frozen=True)
class FeedbackDeps:
    """FastAPI dependencies supplied by the host.

    - `current_user`: returns the signed-in user (any object with an int `id`), raises 401 if none.
    - `viewer_is_admin`: returns whether the signed-in user is an admin. Must itself depend on
      `current_user` (FastAPI caches it per request, so it runs once).
    - `get_repo`: returns a `FeedbackRepository` for this request (e.g. `PgFeedbackRepository`
      over the host's request-scoped connection).
    - `require_csrf`: raises 403 unless the request carries a valid CSRF token. With anonymous
      submissions on, it must also pass for a visitor without a session (the host has to give
      anonymous visitors a CSRF token).

    Only needed with `create_feedback_router(..., allow_anonymous=True)` or `public_board=True`:

    - `optional_user`: like `current_user`, but returns None instead of raising 401. (Both flags.)
    - `optional_viewer_is_admin`: whether the (optional) user is an admin; False when anonymous.
      Must depend on `optional_user`. With `allow_anonymous` alone it defaults to "never admin"
      (admins then hit the per-author rate limit like everyone else); `public_board` requires it,
      because the reads it opens up are also how admins read private items.
    - `anonymous_key`: a stable, non-reversible key for the anonymous caller, used only for rate
      limiting. Build one with `anonymous_key_dependency(secret)` (HMAC of the client IP).
      (`allow_anonymous` only.)
    """

    current_user: Callable[..., Any]
    viewer_is_admin: Callable[..., bool]
    get_repo: Callable[..., FeedbackRepository]
    require_csrf: Callable[..., None]
    optional_user: Callable[..., Any] | None = None
    optional_viewer_is_admin: Callable[..., bool] | None = None
    anonymous_key: Callable[..., str] | None = None


def client_ip(request: Request) -> str:
    """The caller's IP: the first `X-Forwarded-For` hop (set by the host's proxy, e.g. Vercel or
    Caddy), else the peer address. Only trustworthy behind a proxy that sets or overwrites the
    header; without one a client can choose its own key and only the global cap still applies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def anonymous_key_dependency(secret: str | Callable[[], str]) -> Callable[[Request], str]:
    """FastAPI dependency returning HMAC-SHA256(secret, client IP) as hex. The raw IP is never
    stored; without the secret the key cannot be mapped back to an address. Pass a callable to
    read the secret lazily (e.g. from settings loaded at request time)."""

    def anonymous_key(request: Request) -> str:
        key = secret() if callable(secret) else secret
        if not key:
            raise RuntimeError("anonymous_key_dependency needs a non-empty secret")
        return hmac.new(key.encode(), client_ip(request).encode(), hashlib.sha256).hexdigest()

    return anonymous_key


def _never_admin() -> bool:
    return False


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _not_found() -> HTTPException:
    return _error(404, "not_found", "Feedback item not found")


def create_feedback_router(
    deps: FeedbackDeps,
    *,
    prefix: str = "/api/feedback",
    allow_anonymous: bool = False,
    public_board: bool = False,
) -> APIRouter:
    """`allow_anonymous=True` lets visitors without a session submit feedback (create only); it
    needs `deps.optional_user` and `deps.anonymous_key`.

    `public_board=True` lets visitors without a session read the public board (list with
    `scope=board`, stats, detail of a public item); it needs `deps.optional_user` and
    `deps.optional_viewer_is_admin`."""
    if allow_anonymous and (deps.optional_user is None or deps.anonymous_key is None):
        raise ValueError("allow_anonymous needs FeedbackDeps.optional_user and .anonymous_key")
    if public_board and (deps.optional_user is None or deps.optional_viewer_is_admin is None):
        raise ValueError(
            "public_board needs FeedbackDeps.optional_user and .optional_viewer_is_admin"
        )
    router = APIRouter(prefix=prefix, tags=["feedback"])

    # Dependencies for the board reads: optional with `public_board`, signed-in otherwise.
    if public_board:
        assert deps.optional_user is not None and deps.optional_viewer_is_admin is not None
        read_user: Callable[..., Any] = deps.optional_user
        read_is_admin: Callable[..., bool] = deps.optional_viewer_is_admin
    else:
        read_user = deps.current_user
        read_is_admin = deps.viewer_is_admin

    def viewer_id_of(user: Any) -> int | None:
        return None if user is None else user.id

    def unauthorized() -> HTTPException:
        return _error(401, "unauthorized", "Sign in required")

    def require_admin(is_admin: bool = Depends(deps.viewer_is_admin)) -> None:
        if not is_admin:
            raise _error(403, "forbidden", "Admin role required")

    def load_visible(
        item_id: int, viewer_id: int | None, is_admin: bool, repo: FeedbackRepository
    ) -> dict[str, Any]:
        item = repo.get(item_id, viewer_id)
        if item is None or not policy.can_view(item, viewer_id, is_admin):
            raise _not_found()
        return item

    def detail(
        item_id: int, viewer_id: int | None, is_admin: bool, repo: FeedbackRepository
    ) -> dict[str, Any]:
        is_admin = is_admin and viewer_id is not None
        item = load_visible(item_id, viewer_id, is_admin, repo)
        out = item_dto(item, viewer_id, is_admin)
        out["notes"] = [
            note_dto(n, is_admin) for n in repo.notes(item_id, include_internal=is_admin)
        ]
        return out

    ItemId = Path(ge=1, le=_MAX_ID)

    def screenshot_or_400(body: CreateItemRequest) -> Any:
        if not body.screenshot:
            return None
        try:
            return decode_screenshot(body.screenshot)
        except ScreenshotError as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "validation_error",
                    "message": "The request could not be validated",
                    "fields": {"screenshot": str(exc)},
                },
            ) from exc

    def rate_limited() -> HTTPException:
        return HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": "Too many submissions this hour"},
            headers={"Retry-After": "3600"},
        )

    def create_signed_in(
        body: CreateItemRequest,
        request: Request,
        user: Any,
        is_admin: bool,
        repo: FeedbackRepository,
    ) -> dict[str, Any]:
        if not is_admin and repo.count_recent_by_author(user.id) >= MAX_ITEMS_PER_HOUR:
            raise rate_limited()
        screenshot = screenshot_or_400(body)
        item_id = repo.create(
            user.id,
            body,
            user_agent=clip_user_agent(request.headers.get("user-agent")),
            screenshot=screenshot,
        )
        return detail(item_id, user.id, is_admin, repo)

    if not allow_anonymous:

        @router.post(
            "",
            status_code=201,
            dependencies=[Depends(deps.current_user), Depends(deps.require_csrf)],
        )
        def create_item(
            body: CreateItemRequest,
            request: Request,
            user: Any = Depends(deps.current_user),
            is_admin: bool = Depends(deps.viewer_is_admin),
            repo: FeedbackRepository = Depends(deps.get_repo),
        ) -> dict[str, Any]:
            return create_signed_in(body, request, user, is_admin, repo)

    else:
        assert deps.optional_user is not None and deps.anonymous_key is not None
        optional_admin = deps.optional_viewer_is_admin or _never_admin

        @router.post("", status_code=201, dependencies=[Depends(deps.require_csrf)])
        def create_item(
            body: CreateItemRequest,
            request: Request,
            user: Any = Depends(deps.optional_user),
            is_admin: bool = Depends(optional_admin),
            anon_key: str = Depends(deps.anonymous_key),
            repo: FeedbackRepository = Depends(deps.get_repo),
        ) -> dict[str, Any]:
            if user is not None:
                return create_signed_in(body, request, user, is_admin, repo)
            mine, everyone = repo.count_recent_anonymous(anon_key)
            if mine >= MAX_ANON_ITEMS_PER_HOUR or everyone >= MAX_ANON_ITEMS_PER_HOUR_TOTAL:
                raise rate_limited()
            screenshot = screenshot_or_400(body)
            item_id = repo.create(
                None,
                body,
                user_agent=clip_user_agent(request.headers.get("user-agent")),
                screenshot=screenshot,
                anon_key=anon_key,
            )
            # The submitter cannot read the item back (it has no author); return what they sent.
            item = repo.get(item_id, None)
            assert item is not None
            return {**item_dto(item, None, False), "notes": []}

    @router.get("")
    def list_items(
        scope: Literal["board", "mine", "all"] = "board",
        kind: Literal["bug", "feedback", "idea"] | None = None,
        status: Literal["new", "under_review", "approved", "planned", "done", "rejected"]
        | None = None,
        q: str | None = Query(default=None, max_length=100),
        sort: Literal["new", "top"] = "new",
        limit: int = Query(default=LIST_LIMIT_DEFAULT, ge=1, le=LIST_LIMIT_MAX),
        offset: int = Query(default=0, ge=0, le=100_000),
        user: Any = Depends(read_user),
        is_admin: bool = Depends(read_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id = viewer_id_of(user)
        if viewer_id is None:
            # Only reachable with `public_board`: a signed-out visitor reads the board, nothing
            # else.
            if scope != "board":
                raise unauthorized()
            is_admin = False
        if scope == "all" and not is_admin:
            raise _error(403, "forbidden", "Admin role required")
        if scope == "board" and status is not None and status not in PUBLIC_STATUSES:
            # The board only ever shows public statuses; asking for another one is empty, not
            # a way to list private items.
            return {"items": [], "total": 0, "limit": limit, "offset": offset}
        q = q.strip() if q else None
        rows, total = repo.list_items(
            viewer_id=viewer_id,
            scope=scope,
            kind=kind,
            status=status,
            q=q or None,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        return {
            "items": [item_dto(r, viewer_id, is_admin) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    @router.get("/meta")
    def meta(is_admin: bool = Depends(deps.viewer_is_admin)) -> dict[str, Any]:
        """Enumerations and the viewer's role, so the UI never hardcodes server rules."""
        return {
            "kinds": list(KINDS),
            "statuses": list(STATUSES),
            "publicStatuses": list(PUBLIC_STATUSES),
            "isAdmin": is_admin,
        }

    @router.get("/stats")
    def stats(
        _user: Any = Depends(read_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """Item counts per public status (the board's columns), the same for every viewer."""
        counts = repo.public_counts()
        by_status = {s: int(counts.get(s, 0)) for s in PUBLIC_STATUSES}
        return {"counts": by_status, "total": sum(by_status.values())}

    @router.get("/{item_id}")
    def get_item(
        item_id: int = ItemId,
        user: Any = Depends(read_user),
        is_admin: bool = Depends(read_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        return detail(item_id, viewer_id_of(user), is_admin, repo)

    @router.get("/{item_id}/screenshot")
    def get_screenshot(
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> Response:
        item = load_visible(item_id, user.id, is_admin, repo)
        if not policy.can_view_context(item, user.id, is_admin):
            raise _not_found()
        shot = repo.screenshot(item_id)
        if shot is None:
            raise _not_found()
        mime, data = shot
        return Response(
            content=data,
            media_type=mime,
            headers={
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
                # Belt and braces: even if a browser sniffed the bytes as HTML, nothing runs.
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "X-Content-Type-Options": "nosniff",
                "Cross-Origin-Resource-Policy": "same-origin",
            },
        )

    @router.put(
        "/{item_id}/vote", dependencies=[Depends(deps.current_user), Depends(deps.require_csrf)]
    )
    def vote(
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        item = load_visible(item_id, user.id, is_admin, repo)
        if not policy.can_vote(item, user.id):
            raise _error(409, "not_votable", "Only items on the board can be voted on")
        repo.vote(item_id, user.id)
        refreshed = repo.get(item_id, user.id)
        assert refreshed is not None
        return item_dto(refreshed, user.id, is_admin)

    @router.delete(
        "/{item_id}/vote", dependencies=[Depends(deps.current_user), Depends(deps.require_csrf)]
    )
    def unvote(
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        load_visible(item_id, user.id, is_admin, repo)
        repo.unvote(item_id, user.id)
        refreshed = repo.get(item_id, user.id)
        assert refreshed is not None
        return item_dto(refreshed, user.id, is_admin)

    @router.patch(
        "/{item_id}",
        dependencies=[
            Depends(deps.current_user),
            Depends(deps.require_csrf),
            Depends(require_admin),
        ],
    )
    def patch_item(
        body: AdminPatchRequest,
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        if repo.get(item_id, user.id) is None:
            raise _not_found()
        fields = {name: getattr(body, name) for name in body.model_fields_set}
        repo.update(item_id, fields, actor_id=user.id)
        return detail(item_id, user.id, True, repo)

    @router.post(
        "/{item_id}/notes",
        status_code=201,
        dependencies=[
            Depends(deps.current_user),
            Depends(deps.require_csrf),
            Depends(require_admin),
        ],
    )
    def add_note(
        body: NoteRequest,
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        if repo.get(item_id, user.id) is None:
            raise _not_found()
        return note_dto(repo.add_note(item_id, user.id, body.body, body.visibility), True)

    @router.delete(
        "/{item_id}/notes/{note_id}",
        status_code=204,
        dependencies=[
            Depends(deps.current_user),
            Depends(deps.require_csrf),
            Depends(require_admin),
        ],
    )
    def delete_note(
        item_id: int = ItemId,
        note_id: int = Path(ge=1, le=_MAX_ID),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> Response:
        if not repo.delete_note(item_id, note_id):
            raise _error(404, "not_found", "Note not found")
        return Response(status_code=204)

    @router.delete(
        "/{item_id}",
        status_code=204,
        dependencies=[Depends(deps.current_user), Depends(deps.require_csrf)],
    )
    def delete_item(
        item_id: int = ItemId,
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> Response:
        item = load_visible(item_id, user.id, is_admin, repo)
        if not policy.can_delete(item, user.id, is_admin):
            raise _error(403, "forbidden", "You can no longer delete this item")
        repo.delete(item_id)
        return Response(status_code=204)

    return router
