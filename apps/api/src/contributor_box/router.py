"""FastAPI router factory. The host injects its own auth, CSRF, admin check and DB access through
`FeedbackDeps`; this module owns the endpoints, validation and authorisation rules.

Every endpoint requires a signed-in user unless the host opts in to anonymous submissions, a
public board or anonymous comments (all below). Every admin action is checked here, server-side,
with `require_admin` (403 for a signed-in non-admin); every read goes through `policy.can_view`
(404 for an item the viewer may not see). Unsafe methods require the host's CSRF dependency.

Errors are raised as `HTTPException(status, detail={"code", "message"})`, the shape the host's
error handler turns into `{"error": {"code", "message"}}`. Request validation failures are
FastAPI's `RequestValidationError`; hosts should install a handler that reshapes it into the same
contract (job-seeking does: 400 `validation_error` with `fields`).

Dependency order on signed-in-only unsafe routes is auth (401), then CSRF (403), then admin
(403), so an anonymous caller always gets 401.

Anonymous submissions (opt-in, `allow_anonymous=True`): `POST <prefix>` then also accepts a caller
with no session, still behind the host's CSRF check, rate-limited per anonymous key (see
`anonymous_key_dependency`) and across all anonymous visitors. With `deps.visitor_cookies` the
item is tied to the visitor's pseudonymous identity (see `identity.py`).

Public board (opt-in, `public_board=True`): the read side works without a session, for a public
roadmap page: `GET <prefix>?scope=board`, `GET <prefix>/stats`, `GET <prefix>/{id}` and
`GET <prefix>/{id}/comments` for a public-status item (every status but `rejected`). A
signed-out viewer gets public fields only and 401 for `scope=mine` or `scope=all`.

Anonymous comments (opt-in, `allow_anonymous_comments=True`, needs `public_board` and
`deps.visitor_cookies`): signed-out visitors comment, reply and report on public items under a
pseudonym, rate-limited per visitor cookie, per IP key and globally. Votes always need a session.
"""

import base64
import binascii
import hashlib
import hmac
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, Response

from contributor_box import policy
from contributor_box.comments import CommentContext, register_comment_routes
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
from contributor_box.identity import (
    Visitor,
    VisitorCookies,
    clean_display_name,
    email_local_part,
    initial,
    pseudonym,
    tone_for,
)
from contributor_box.repository import FeedbackRepository, Row, Sort, sort_key
from contributor_box.schemas import (
    AdminPatchRequest,
    CreateItemRequest,
    IdentityRequest,
    NoteRequest,
    VoteRequest,
    clip_user_agent,
)
from contributor_box.screenshot import ScreenshotError, decode_screenshot

_MAX_ID = 9_223_372_036_854_775_807


@dataclass(frozen=True)
class FeedbackDeps:
    """FastAPI dependencies supplied by the host.

    - `current_user`: returns the signed-in user (any object with an int `id`, and ideally an
      `email`, whose local part is the default display name), raises 401 if none.
    - `viewer_is_admin`: returns whether the signed-in user is an admin. Must itself depend on
      `current_user` (FastAPI caches it per request, so it runs once).
    - `get_repo`: returns a `FeedbackRepository` for this request (e.g. `PgFeedbackRepository`
      over the host's request-scoped connection).
    - `require_csrf`: raises 403 unless the request carries a valid CSRF token. With anonymous
      writes on, it must also pass for a visitor without a session (the host has to give
      anonymous visitors a CSRF token).

    Only needed with `allow_anonymous`, `public_board` or `allow_anonymous_comments`:

    - `optional_user`: like `current_user`, but returns None instead of raising 401.
    - `optional_viewer_is_admin`: whether the (optional) user is an admin; False when anonymous.
      Must depend on `optional_user`. With `allow_anonymous` alone it defaults to "never admin";
      `public_board` requires it, because the reads it opens up are also how admins read
      private items.
    - `anonymous_key`: a stable, non-reversible key for the anonymous caller's IP, used only for
      rate limiting. Build one with `anonymous_key_dependency(secret)`.
    - `visitor_cookies`: returns a `VisitorCookies` (the signed visitor cookie that carries an
      anonymous visitor's pseudonymous identity). Required by `allow_anonymous_comments`;
      optional with `allow_anonymous` (anonymous items then carry the visitor's pseudonym).
    """

    current_user: Callable[..., Any]
    viewer_is_admin: Callable[..., bool]
    get_repo: Callable[..., FeedbackRepository]
    require_csrf: Callable[..., None]
    optional_user: Callable[..., Any] | None = None
    optional_viewer_is_admin: Callable[..., bool] | None = None
    anonymous_key: Callable[..., str] | None = None
    visitor_cookies: Callable[..., VisitorCookies] | None = None


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


def _no_visitor_cookies() -> None:
    return None


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _not_found() -> HTTPException:
    return _error(404, "not_found", "Feedback item not found")


def _field_error(field: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "validation_error",
            "message": "The request could not be validated",
            "fields": {field: message},
        },
    )


def encode_cursor(row: Row, sort: Sort) -> str:
    """Opaque "load more" cursor: the keyset of the last row shown, for this sort."""
    key = [v.isoformat() if isinstance(v, datetime) else v for v in sort_key(row, sort)]
    raw = json.dumps({"s": sort, "k": key}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, sort: Sort) -> tuple[Any, ...]:
    """The keyset in `cursor`, or a 400 field error (wrong shape, or made for another sort)."""
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        if not isinstance(data, dict) or data.get("s") != sort:
            raise ValueError("cursor is for another sort")
        key = data["k"]
        if sort == "top":
            score, created, item_id = key
            if type(score) is not int or type(item_id) is not int:
                raise ValueError("bad cursor")
            return (score, datetime.fromisoformat(created), item_id)
        created, item_id = key
        if type(item_id) is not int:
            raise ValueError("bad cursor")
        return (datetime.fromisoformat(created), item_id)
    except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError) as exc:
        raise _field_error("cursor", "invalid cursor") from exc


def create_feedback_router(
    deps: FeedbackDeps,
    *,
    prefix: str = "/api/feedback",
    allow_anonymous: bool = False,
    public_board: bool = False,
    allow_anonymous_comments: bool = False,
    initial_status: Literal["new", "under_review", "approved", "planned", "done"] = "new",
) -> APIRouter:
    """`initial_status` is the status a newly submitted item starts in (default `new`, which waits
    for an admin). A host that wants submissions on the public board straight away passes
    `approved` ("under consideration"); admins can still move or reject them.

    `allow_anonymous=True` lets visitors without a session submit feedback (create only); it
    needs `deps.optional_user` and `deps.anonymous_key`.

    `public_board=True` lets visitors without a session read the public board (list with
    `scope=board`, stats, detail and comments of a public item); it needs `deps.optional_user`
    and `deps.optional_viewer_is_admin`.

    `allow_anonymous_comments=True` lets them comment and report under a pseudonym; it needs
    `public_board=True`, `deps.anonymous_key` and `deps.visitor_cookies`."""
    if allow_anonymous and (deps.optional_user is None or deps.anonymous_key is None):
        raise ValueError("allow_anonymous needs FeedbackDeps.optional_user and .anonymous_key")
    if public_board and (deps.optional_user is None or deps.optional_viewer_is_admin is None):
        raise ValueError(
            "public_board needs FeedbackDeps.optional_user and .optional_viewer_is_admin"
        )
    if allow_anonymous_comments and (
        not public_board or deps.anonymous_key is None or deps.visitor_cookies is None
    ):
        raise ValueError(
            "allow_anonymous_comments needs public_board=True, FeedbackDeps.anonymous_key and"
            " .visitor_cookies"
        )
    router = APIRouter(prefix=prefix, tags=["feedback"])
    anonymous_identity = allow_anonymous or allow_anonymous_comments

    # Dependencies for the board reads: optional with `public_board`, signed-in otherwise.
    if public_board:
        assert deps.optional_user is not None and deps.optional_viewer_is_admin is not None
        read_user: Callable[..., Any] = deps.optional_user
        read_is_admin: Callable[..., bool] = deps.optional_viewer_is_admin
    else:
        read_user = deps.current_user
        read_is_admin = deps.viewer_is_admin
    cookies_dep: Callable[..., VisitorCookies | None] = deps.visitor_cookies or _no_visitor_cookies

    def read_visitor(
        request: Request, cookies: VisitorCookies | None = Depends(cookies_dep)
    ) -> Visitor | None:
        """The visitor cookie, if present and valid. Never issues one."""
        return cookies.read(request) if cookies is not None else None

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
        item_id: int,
        viewer_id: int | None,
        is_admin: bool,
        repo: FeedbackRepository,
        visitor_key: str | None = None,
    ) -> dict[str, Any]:
        is_admin = is_admin and viewer_id is not None
        item = load_visible(item_id, viewer_id, is_admin, repo)
        out = item_dto(item, viewer_id, is_admin, visitor_key=visitor_key)
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
            raise _field_error("screenshot", str(exc)) from exc

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
            status=initial_status,
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
            response: Response,
            user: Any = Depends(deps.optional_user),
            is_admin: bool = Depends(optional_admin),
            anon_key: str = Depends(deps.anonymous_key),
            cookies: VisitorCookies | None = Depends(cookies_dep),
            repo: FeedbackRepository = Depends(deps.get_repo),
        ) -> dict[str, Any]:
            if user is not None:
                return create_signed_in(body, request, user, is_admin, repo)
            # The visitor's chosen name follows them (comments too), so a typed name becomes
            # their display name. Checked before anything is written.
            name: str | None = None
            if cookies is not None and body.author_name:
                try:
                    name = clean_display_name(body.author_name)
                except ValueError as exc:
                    raise _field_error("authorName", str(exc)) from exc
            mine, everyone = repo.count_recent_anonymous(anon_key)
            if mine >= MAX_ANON_ITEMS_PER_HOUR or everyone >= MAX_ANON_ITEMS_PER_HOUR_TOTAL:
                raise rate_limited()
            screenshot = screenshot_or_400(body)
            visitor = cookies.read_or_issue(request, response) if cookies is not None else None
            if visitor is not None and name is not None:
                repo.set_display_name(visitor_key=visitor.key, name=name)
            item_id = repo.create(
                None,
                body,
                user_agent=clip_user_agent(request.headers.get("user-agent")),
                screenshot=screenshot,
                anon_key=anon_key,
                visitor_key=visitor.key if visitor else None,
                status=initial_status,
            )
            item = repo.get(item_id, None)
            assert item is not None
            return {
                **item_dto(item, None, False, visitor_key=visitor.key if visitor else None),
                "notes": [],
            }

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
        cursor: str | None = Query(default=None, max_length=200),
        user: Any = Depends(read_user),
        is_admin: bool = Depends(read_is_admin),
        visitor: Visitor | None = Depends(read_visitor),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """A page of items. "Load more" passes the previous page's `nextCursor` (keyset
        pagination); `total` is counted on the first page only (`null` with a cursor). `offset`
        still works without a cursor."""
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
            return {
                "items": [],
                "total": 0,
                "limit": limit,
                "offset": offset,
                "nextCursor": None,
            }
        after = decode_cursor(cursor, sort) if cursor else None
        q = q.strip() if q else None
        rows, total = repo.list_items(
            viewer_id=viewer_id,
            scope=scope,
            kind=kind,
            status=status,
            q=q or None,
            sort=sort,
            limit=limit,
            offset=0 if after else offset,
            after=after,
            with_total=after is None,
        )
        visitor_key = visitor.key if visitor and viewer_id is None else None
        return {
            "items": [item_dto(r, viewer_id, is_admin, visitor_key=visitor_key) for r in rows],
            "total": total,
            "limit": limit,
            "offset": 0 if after else offset,
            "nextCursor": encode_cursor(rows[-1], sort) if len(rows) == limit else None,
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

    # --- display identity (who you appear as) ---------------------------------------------------

    identity_user = deps.optional_user if anonymous_identity else deps.current_user
    identity_admin = (
        (deps.optional_viewer_is_admin or _never_admin)
        if anonymous_identity
        else deps.viewer_is_admin
    )
    assert identity_user is not None

    def identity_dto(
        user: Any, is_admin: bool, visitor: Visitor | None, repo: FeedbackRepository
    ) -> dict[str, Any]:
        if user is not None:
            custom = repo.display_name(user_id=user.id)
            name = custom or email_local_part(getattr(user, "email", None))
            return {
                "kind": "user",
                "name": name,
                "customName": custom,
                "pseudonym": None,
                "tag": None,
                "avatar": {"glyph": initial(name), "tone": tone_for(f"user:{user.id}")},
                "team": bool(is_admin),
            }
        assert visitor is not None
        custom = repo.display_name(visitor_key=visitor.key)
        p = pseudonym(visitor.key)
        return {
            "kind": "guest",
            "name": custom,
            "customName": custom,
            "pseudonym": {"en": p.en, "vi": p.vi},
            "tag": p.tag,
            "avatar": {"glyph": p.emoji, "tone": p.tone},
            "team": False,
        }

    def resolve_visitor(
        user: Any, request: Request, response: Response, cookies: VisitorCookies | None
    ) -> Visitor | None:
        if user is not None:
            return None
        if cookies is None or not anonymous_identity:
            raise unauthorized()
        return cookies.read_or_issue(request, response)

    @router.get("/identity")
    def get_identity(
        request: Request,
        response: Response,
        user: Any = Depends(identity_user),
        is_admin: bool = Depends(identity_admin),
        cookies: VisitorCookies | None = Depends(cookies_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """Who the caller appears as. For a signed-out visitor this issues the visitor cookie
        (like `GET /api/auth/csrf` issues the CSRF cookie), so the composer can preview the
        pseudonym before the first comment."""
        response.headers["Cache-Control"] = "private, no-store"
        visitor = resolve_visitor(user, request, response, cookies)
        return identity_dto(user, is_admin, visitor, repo)

    @router.put("/identity", dependencies=[Depends(deps.require_csrf)])
    def put_identity(
        request: Request,
        response: Response,
        body: IdentityRequest = Body(...),
        user: Any = Depends(identity_user),
        is_admin: bool = Depends(identity_admin),
        cookies: VisitorCookies | None = Depends(cookies_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """Sets (or with `displayName: null` clears) the caller's chosen display name."""
        visitor = resolve_visitor(user, request, response, cookies)
        if user is not None:
            repo.set_display_name(user_id=user.id, name=body.display_name)
        else:
            assert visitor is not None
            repo.set_display_name(visitor_key=visitor.key, name=body.display_name)
        return identity_dto(user, is_admin, visitor, repo)

    # --- comments (registered before `/{item_id}` so `/comments/reported` is not an id) ---------

    register_comment_routes(
        router,
        CommentContext(
            deps=deps,
            read_user=read_user,
            read_is_admin=read_is_admin,
            cookies_dep=cookies_dep,
            read_visitor=read_visitor,
            anonymous_comments=allow_anonymous_comments,
            load_visible=load_visible,
            item_id_path=ItemId,
        ),
    )

    @router.get("/{item_id}")
    def get_item(
        item_id: int = ItemId,
        user: Any = Depends(read_user),
        is_admin: bool = Depends(read_is_admin),
        visitor: Visitor | None = Depends(read_visitor),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id = viewer_id_of(user)
        visitor_key = visitor.key if visitor and viewer_id is None else None
        return detail(item_id, viewer_id, is_admin, repo, visitor_key)

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
        body: VoteRequest | None = Body(default=None),
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """`{"value": 1}` (or no body) up, `{"value": -1}` down; replaces an earlier vote."""
        item = load_visible(item_id, user.id, is_admin, repo)
        if not policy.can_vote(item, user.id):
            raise _error(409, "not_votable", "Only items on the board can be voted on")
        repo.vote(item_id, user.id, body.value if body else 1)
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
