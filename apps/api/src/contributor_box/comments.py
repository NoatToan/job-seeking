"""Comment endpoints: two-level threads, +1 / -1 votes, reports and moderation, under
`<prefix>/{item_id}/comments` (plus the admin queue at `<prefix>/comments/reported`).

Registered by `create_feedback_router`; the rules themselves are in `policy.py`.

- Read: whoever can see the item (`policy.can_read_comments`). Signed out only with
  `public_board`, and then only on public items.
- Write: signed in, or (with `allow_anonymous_comments`) an anonymous visitor identified by the
  signed visitor cookie. A reply to a reply joins the same top-level thread.
- Votes: signed in only. Moderation (hide, unhide, dismiss reports, the reported queue): admins.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request, Response

from contributor_box import policy
from contributor_box.constants import (
    COMMENTS_PAGE_DEFAULT,
    COMMENTS_PAGE_MAX,
    MAX_ANON_COMMENTS_PER_HOUR,
    MAX_ANON_COMMENTS_PER_HOUR_TOTAL,
    MAX_ANON_COMMENTS_PER_IP_PER_HOUR,
    MAX_ANON_REPORTS_PER_HOUR_TOTAL,
    MAX_COMMENTS_PER_HOUR,
    REPLIES_PAGE_MAX,
    REPLIES_PREVIEW,
)
from contributor_box.dto import comment_dto
from contributor_box.identity import Visitor, VisitorCookies
from contributor_box.repository import FeedbackRepository, iso
from contributor_box.schemas import (
    CommentCreateRequest,
    CommentEditRequest,
    ReportRequest,
    VoteRequest,
)

_MAX_ID = 9_223_372_036_854_775_807


@dataclass(frozen=True)
class CommentContext:
    deps: Any  # FeedbackDeps (not imported: router.py imports this module)
    read_user: Callable[..., Any]
    read_is_admin: Callable[..., bool]
    cookies_dep: Callable[..., VisitorCookies | None]
    read_visitor: Callable[..., Visitor | None]
    anonymous_comments: bool
    load_visible: Callable[[int, int | None, bool, FeedbackRepository], dict[str, Any]]
    item_id_path: Any


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _comment_not_found() -> HTTPException:
    return _error(404, "not_found", "Comment not found")


def _never_admin() -> bool:
    return False


def _rate_limited() -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={"code": "rate_limited", "message": "Too many comments this hour"},
        headers={"Retry-After": "3600"},
    )


def register_comment_routes(router: APIRouter, ctx: CommentContext) -> None:
    deps = ctx.deps
    anonymous = ctx.anonymous_comments
    ItemId = ctx.item_id_path
    CommentId = Path(ge=1, le=_MAX_ID)

    # Writers: optional user when anonymous comments are on, else signed-in only (401 first).
    if anonymous:
        write_user: Callable[..., Any] = deps.optional_user
        write_is_admin: Callable[..., bool] = deps.optional_viewer_is_admin or _never_admin
        write_guard: list[Any] = [Depends(deps.require_csrf)]
        anon_key_dep: Callable[..., str | None] = deps.anonymous_key
    else:
        write_user = deps.current_user
        write_is_admin = deps.viewer_is_admin
        write_guard = [Depends(deps.current_user), Depends(deps.require_csrf)]

        def _no_anon_key() -> None:
            return None

        anon_key_dep = _no_anon_key

    signed_in_guard = [Depends(deps.current_user), Depends(deps.require_csrf)]

    def require_admin(is_admin: bool = Depends(deps.viewer_is_admin)) -> None:
        if not is_admin:
            raise _error(403, "forbidden", "Admin role required")

    admin_guard = [*signed_in_guard, Depends(require_admin)]

    def viewer_of(
        user: Any, is_admin: bool, visitor: Visitor | None
    ) -> tuple[int | None, bool, str | None]:
        if user is None:
            return None, False, visitor.key if visitor else None
        return user.id, is_admin, None

    def dto(
        comment: dict[str, Any],
        item: dict[str, Any],
        viewer_id: int | None,
        visitor_key: str | None,
        is_admin: bool,
        now: datetime,
    ) -> dict[str, Any]:
        return comment_dto(
            comment,
            item=item,
            viewer_id=viewer_id,
            visitor_key=visitor_key,
            is_admin=is_admin,
            anonymous_allowed=anonymous,
            now=now,
        )

    def load_comment(
        repo: FeedbackRepository,
        item_id: int,
        comment_id: int,
        viewer_id: int | None,
        is_admin: bool,
    ) -> dict[str, Any]:
        comment = repo.get_comment(item_id, comment_id, viewer_id)
        if comment is None:
            raise _comment_not_found()
        # A hidden comment is not there for anyone but admins.
        if comment["hidden_at"] is not None and not is_admin:
            raise _comment_not_found()
        return comment

    # --- admin queue (static path first) --------------------------------------------------------

    @router.get("/comments/reported", dependencies=[Depends(require_admin)])
    def reported_comments(
        limit: int = Query(default=COMMENTS_PAGE_DEFAULT, ge=1, le=COMMENTS_PAGE_MAX),
        offset: int = Query(default=0, ge=0, le=100_000),
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        rows, total = repo.reported_comments(limit=limit, offset=offset)
        now = datetime.now(UTC)
        out = []
        for row in rows:
            item = repo.get(row["item_id"], user.id)
            if item is None:
                continue
            entry = dto(row, item, user.id, None, True, now)
            entry["item"] = {
                "id": str(row["item_id"]),
                "title": row["item_title"],
                "status": row["item_status"],
            }
            entry["reasons"] = list(row.get("reasons") or [])
            entry["lastReportedAt"] = iso(row.get("last_reported_at"))
            out.append(entry)
        return {"comments": out, "total": total, "limit": limit, "offset": offset}

    # --- read ---------------------------------------------------------------------------------

    @router.get("/{item_id}/comments")
    def list_comments(
        item_id: int = ItemId,
        limit: int = Query(default=COMMENTS_PAGE_DEFAULT, ge=1, le=COMMENTS_PAGE_MAX),
        offset: int = Query(default=0, ge=0, le=100_000),
        user: Any = Depends(ctx.read_user),
        is_admin: bool = Depends(ctx.read_is_admin),
        visitor: Visitor | None = Depends(ctx.read_visitor),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id, is_admin, visitor_key = viewer_of(user, is_admin, visitor)
        item = ctx.load_visible(item_id, viewer_id, is_admin, repo)
        rows, total, replies = repo.list_comments(
            item_id,
            viewer_id=viewer_id,
            include_hidden=is_admin,
            limit=limit,
            offset=offset,
            replies_preview=REPLIES_PREVIEW,
        )
        now = datetime.now(UTC)
        by_parent: dict[int, list[dict[str, Any]]] = {}
        for reply in replies:
            by_parent.setdefault(reply["parent_id"], []).append(
                dto(reply, item, viewer_id, visitor_key, is_admin, now)
            )
        comments = []
        for row in rows:
            entry = dto(row, item, viewer_id, visitor_key, is_admin, now)
            entry["replies"] = by_parent.get(row["id"], [])
            comments.append(entry)
        return {
            "comments": comments,
            "total": total,
            "limit": limit,
            "offset": offset,
            "locked": bool(item["comments_locked"]),
            "canComment": policy.can_comment(
                item, viewer_id, is_admin, anonymous_allowed=anonymous
            ),
        }

    @router.get("/{item_id}/comments/{comment_id}/replies")
    def list_replies(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        limit: int = Query(default=REPLIES_PAGE_MAX, ge=1, le=REPLIES_PAGE_MAX),
        offset: int = Query(default=0, ge=0, le=100_000),
        user: Any = Depends(ctx.read_user),
        is_admin: bool = Depends(ctx.read_is_admin),
        visitor: Visitor | None = Depends(ctx.read_visitor),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id, is_admin, visitor_key = viewer_of(user, is_admin, visitor)
        item = ctx.load_visible(item_id, viewer_id, is_admin, repo)
        parent = repo.get_comment(item_id, comment_id, viewer_id)
        if parent is None or parent["parent_id"] is not None:
            raise _comment_not_found()
        rows, total = repo.list_replies(
            item_id,
            comment_id,
            viewer_id=viewer_id,
            include_hidden=is_admin,
            limit=limit,
            offset=offset,
        )
        now = datetime.now(UTC)
        return {
            "replies": [dto(r, item, viewer_id, visitor_key, is_admin, now) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    # --- write --------------------------------------------------------------------------------

    @router.post("/{item_id}/comments", status_code=201, dependencies=write_guard)
    def create_comment(
        request: Request,
        response: Response,
        body: CommentCreateRequest,
        item_id: int = ItemId,
        user: Any = Depends(write_user),
        is_admin: bool = Depends(write_is_admin),
        cookies: VisitorCookies | None = Depends(ctx.cookies_dep),
        anon_key: str | None = Depends(anon_key_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id = user.id if user is not None else None
        is_admin = is_admin and viewer_id is not None
        item = ctx.load_visible(item_id, viewer_id, is_admin, repo)
        if body.website:
            # Honeypot filled in: a bot. Nothing is stored.
            raise _error(400, "spam_detected", "The comment could not be posted")
        if not policy.can_comment(item, viewer_id, is_admin, anonymous_allowed=anonymous):
            if item["comments_locked"]:
                raise _error(409, "comments_locked", "Comments on this item are locked")
            raise _error(403, "forbidden", "You cannot comment on this item")
        parent_id: int | None = None
        if body.parent_id is not None:
            target = repo.get_comment(item_id, int(body.parent_id), viewer_id)
            if target is None or (target["hidden_at"] is not None and not is_admin):
                raise _comment_not_found()
            if policy.is_comment_gone(target):
                raise _error(409, "comment_gone", "That comment was removed")
            # Two levels: a reply to a reply joins its top-level thread.
            parent_id = target["parent_id"] if target["parent_id"] is not None else target["id"]

        visitor: Visitor | None = None
        if viewer_id is not None:
            if (
                not is_admin
                and repo.count_recent_comments_by_author(viewer_id) >= MAX_COMMENTS_PER_HOUR
            ):
                raise _rate_limited()
        else:
            assert cookies is not None and anon_key is not None
            visitor = cookies.read_or_issue(request, response)
            mine, same_ip, everyone = repo.count_recent_anonymous_comments(visitor.key, anon_key)
            if (
                mine >= MAX_ANON_COMMENTS_PER_HOUR
                or same_ip >= MAX_ANON_COMMENTS_PER_IP_PER_HOUR
                or everyone >= MAX_ANON_COMMENTS_PER_HOUR_TOTAL
            ):
                raise _rate_limited()

        comment_id = repo.create_comment(
            item_id,
            parent_id=parent_id,
            body=body.body,
            author_id=viewer_id,
            visitor_key=visitor.key if visitor else None,
            anon_key=anon_key if visitor else None,
            by_team=is_admin,
        )
        comment = repo.get_comment(item_id, comment_id, viewer_id)
        assert comment is not None
        entry = dto(
            comment, item, viewer_id, visitor.key if visitor else None, is_admin, datetime.now(UTC)
        )
        if parent_id is None:
            entry["replies"] = []
        return entry

    def writer_identity(
        user: Any, is_admin: bool, request: Request, cookies: VisitorCookies | None
    ) -> tuple[int | None, bool, str | None]:
        if user is not None:
            return user.id, is_admin, None
        visitor = cookies.read(request) if cookies is not None else None
        if visitor is None:
            # No session and no visitor cookie: there is nothing this caller could own.
            raise _error(401, "unauthorized", "Sign in required")
        return None, False, visitor.key

    @router.patch("/{item_id}/comments/{comment_id}", dependencies=write_guard)
    def edit_comment(
        request: Request,
        body: CommentEditRequest,
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(write_user),
        is_admin: bool = Depends(write_is_admin),
        cookies: VisitorCookies | None = Depends(ctx.cookies_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        viewer_id, is_admin, visitor_key = writer_identity(user, is_admin, request, cookies)
        item = ctx.load_visible(item_id, viewer_id, is_admin, repo)
        comment = load_comment(repo, item_id, comment_id, viewer_id, is_admin)
        now = datetime.now(UTC)
        if not policy.can_edit_comment(comment, viewer_id, visitor_key, now):
            raise _error(403, "forbidden", "You can no longer edit this comment")
        repo.edit_comment(comment_id, body.body)
        refreshed = repo.get_comment(item_id, comment_id, viewer_id)
        assert refreshed is not None
        return dto(refreshed, item, viewer_id, visitor_key, is_admin, now)

    @router.delete("/{item_id}/comments/{comment_id}", dependencies=write_guard)
    def delete_comment(
        request: Request,
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(write_user),
        is_admin: bool = Depends(write_is_admin),
        cookies: VisitorCookies | None = Depends(ctx.cookies_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """`{"result": "soft", "comment": <placeholder>}` when replies keep a "[deleted]"
        placeholder in the thread, else `{"result": "hard", "comment": null}`."""
        viewer_id, is_admin, visitor_key = writer_identity(user, is_admin, request, cookies)
        item = ctx.load_visible(item_id, viewer_id, is_admin, repo)
        comment = load_comment(repo, item_id, comment_id, viewer_id, is_admin)
        now = datetime.now(UTC)
        if not policy.can_delete_comment(comment, viewer_id, visitor_key, is_admin, now):
            raise _error(403, "forbidden", "You can no longer delete this comment")
        result = repo.delete_comment(comment_id)
        refreshed = repo.get_comment(item_id, comment_id, viewer_id) if result == "soft" else None
        return {
            "result": result,
            "comment": dto(refreshed, item, viewer_id, visitor_key, is_admin, now)
            if refreshed
            else None,
        }

    # --- votes (signed in) ----------------------------------------------------------------------

    @router.put("/{item_id}/comments/{comment_id}/vote", dependencies=signed_in_guard)
    def vote_comment(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        body: VoteRequest | None = Body(default=None),
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        item = ctx.load_visible(item_id, user.id, is_admin, repo)
        comment = load_comment(repo, item_id, comment_id, user.id, is_admin)
        if not policy.can_vote_comment(comment, user.id):
            raise _error(409, "not_votable", "You cannot vote on this comment")
        repo.vote_comment(comment_id, user.id, body.value if body else 1)
        refreshed = repo.get_comment(item_id, comment_id, user.id)
        assert refreshed is not None
        return dto(refreshed, item, user.id, None, is_admin, datetime.now(UTC))

    @router.delete("/{item_id}/comments/{comment_id}/vote", dependencies=signed_in_guard)
    def unvote_comment(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(deps.current_user),
        is_admin: bool = Depends(deps.viewer_is_admin),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        item = ctx.load_visible(item_id, user.id, is_admin, repo)
        load_comment(repo, item_id, comment_id, user.id, is_admin)
        repo.unvote_comment(comment_id, user.id)
        refreshed = repo.get_comment(item_id, comment_id, user.id)
        assert refreshed is not None
        return dto(refreshed, item, user.id, None, is_admin, datetime.now(UTC))

    # --- reports ------------------------------------------------------------------------------

    @router.post("/{item_id}/comments/{comment_id}/report", dependencies=write_guard)
    def report_comment(
        request: Request,
        response: Response,
        item_id: int = ItemId,
        comment_id: int = CommentId,
        body: ReportRequest | None = Body(default=None),
        user: Any = Depends(write_user),
        is_admin: bool = Depends(write_is_admin),
        cookies: VisitorCookies | None = Depends(ctx.cookies_dep),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        """Flags a comment for admin review. Idempotent per reporter: `{"reported": true}`."""
        viewer_id = user.id if user is not None else None
        is_admin = is_admin and viewer_id is not None
        ctx.load_visible(item_id, viewer_id, is_admin, repo)
        comment = load_comment(repo, item_id, comment_id, viewer_id, is_admin)
        visitor_key: str | None = None
        if viewer_id is None:
            assert cookies is not None
            visitor_key = cookies.read_or_issue(request, response).key
        if not policy.can_report_comment(
            comment, viewer_id, visitor_key, anonymous_allowed=anonymous
        ):
            raise _error(409, "not_reportable", "You cannot report this comment")
        if viewer_id is None and repo.count_recent_anonymous_reports() >= (
            MAX_ANON_REPORTS_PER_HOUR_TOTAL
        ):
            raise _rate_limited()
        repo.report_comment(
            comment_id,
            reporter_id=viewer_id,
            reporter_visitor_key=visitor_key,
            reason=body.reason if body else None,
        )
        return {"reported": True}

    # --- moderation (admins) ------------------------------------------------------------------

    def set_hidden(
        item_id: int, comment_id: int, hidden: bool, user: Any, repo: FeedbackRepository
    ) -> dict[str, Any]:
        item = ctx.load_visible(item_id, user.id, True, repo)
        comment = load_comment(repo, item_id, comment_id, user.id, True)
        if comment["deleted_at"] is not None:
            raise _error(409, "comment_gone", "That comment was deleted")
        repo.set_comment_hidden(comment_id, hidden, actor_id=user.id)
        refreshed = repo.get_comment(item_id, comment_id, user.id)
        assert refreshed is not None
        return dto(refreshed, item, user.id, None, True, datetime.now(UTC))

    @router.put("/{item_id}/comments/{comment_id}/hidden", dependencies=admin_guard)
    def hide_comment(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        return set_hidden(item_id, comment_id, True, user, repo)

    @router.delete("/{item_id}/comments/{comment_id}/hidden", dependencies=admin_guard)
    def unhide_comment(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> dict[str, Any]:
        return set_hidden(item_id, comment_id, False, user, repo)

    @router.delete(
        "/{item_id}/comments/{comment_id}/reports", status_code=204, dependencies=admin_guard
    )
    def dismiss_reports(
        item_id: int = ItemId,
        comment_id: int = CommentId,
        user: Any = Depends(deps.current_user),
        repo: FeedbackRepository = Depends(deps.get_repo),
    ) -> Response:
        ctx.load_visible(item_id, user.id, True, repo)
        load_comment(repo, item_id, comment_id, user.id, True)
        repo.dismiss_reports(comment_id)
        return Response(status_code=204)
