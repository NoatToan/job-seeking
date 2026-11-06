"""Who may see or do what. Pure functions over an item row, so every rule is unit-tested without a
database, and the router never inlines an authorisation decision.

- Admin: sees every item and its context (page URL, selector, region, screenshot, user agent);
  votes on public items; edits, sets status, adds notes, deletes anything.
- Author: sees own items in any status, with context; votes on public items; deletes own items
  while they are still `new`. Cannot edit, set status or add notes.
- Any other signed-in user: sees public-status items only, without context; votes on them.
- A signed-out visitor (`viewer_id` None; only reaches reads when the host turns on
  `public_board=True`): sees public-status items only, without context; never votes.
- Anonymous items (`author_id` NULL, only when the host allows anonymous submissions) have no
  author: nobody but admins sees their context or may delete them. An anonymous visitor
  (`viewer_id` None) is never the author of anything.

Items a viewer may not see are reported as 404, never 403, so their existence is not confirmed.

Votes are +1 / -1 and need a session (a visitor cookie is free to mint, so anonymous votes could
be stuffed). Comments:

- Readable by whoever can see the item (so comments on a private item: its author and admins).
- Written by signed-in viewers who can see the item, and (host opt-in) by anonymous visitors on
  public items. Nobody but admins writes on a locked item.
- Own comments (same user, or same visitor key when signed out): editable for
  `COMMENT_EDIT_WINDOW_SECONDS`, deletable for `COMMENT_DELETE_WINDOW_SECONDS`. Admins delete or
  hide any comment at any time, but never edit someone else's words.
- Votes on comments: signed-in, not on your own comment, not on a deleted or hidden one.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from contributor_box.constants import (
    COMMENT_DELETE_WINDOW_SECONDS,
    COMMENT_EDIT_WINDOW_SECONDS,
    PUBLIC_STATUSES,
)


def is_public(item: Mapping[str, Any]) -> bool:
    return item["status"] in PUBLIC_STATUSES


def is_anonymous(item: Mapping[str, Any]) -> bool:
    return item["author_id"] is None


def is_author(item: Mapping[str, Any], viewer_id: int | None) -> bool:
    return (
        viewer_id is not None and item["author_id"] is not None and item["author_id"] == viewer_id
    )


def can_view(item: Mapping[str, Any], viewer_id: int | None, is_admin: bool) -> bool:
    if viewer_id is None:
        # Signed out: public items only. Nobody without a session is an admin, whatever the
        # caller passes.
        return is_public(item)
    return is_admin or is_author(item, viewer_id) or is_public(item)


def can_view_context(item: Mapping[str, Any], viewer_id: int | None, is_admin: bool) -> bool:
    if viewer_id is None:
        return False
    return is_admin or is_author(item, viewer_id)


def can_vote(item: Mapping[str, Any], viewer_id: int | None) -> bool:
    """Signed-in viewers vote on public items; a signed-out visitor never votes."""
    return viewer_id is not None and is_public(item)


def can_delete(item: Mapping[str, Any], viewer_id: int | None, is_admin: bool) -> bool:
    if viewer_id is None:
        return False
    return is_admin or (is_author(item, viewer_id) and item["status"] == "new")


# --- comments ------------------------------------------------------------------------------------


def can_read_comments(item: Mapping[str, Any], viewer_id: int | None, is_admin: bool) -> bool:
    return can_view(item, viewer_id, is_admin)


def can_comment(
    item: Mapping[str, Any],
    viewer_id: int | None,
    is_admin: bool,
    *,
    anonymous_allowed: bool,
) -> bool:
    """Whether the viewer may add a comment (or reply) to `item` now."""
    if viewer_id is None:
        return anonymous_allowed and is_public(item) and not item["comments_locked"]
    if not can_view(item, viewer_id, is_admin):
        return False
    return is_admin or not item["comments_locked"]


def is_comment_author(
    comment: Mapping[str, Any], viewer_id: int | None, visitor_key: str | None
) -> bool:
    if viewer_id is not None:
        return comment["author_id"] is not None and comment["author_id"] == viewer_id
    return (
        visitor_key is not None
        and comment["visitor_key"] is not None
        and comment["visitor_key"] == visitor_key
    )


def is_comment_gone(comment: Mapping[str, Any]) -> bool:
    return comment["deleted_at"] is not None or comment["hidden_at"] is not None


def _age_seconds(comment: Mapping[str, Any], now: datetime) -> float:
    return (now - comment["created_at"]).total_seconds()


def can_edit_comment(
    comment: Mapping[str, Any], viewer_id: int | None, visitor_key: str | None, now: datetime
) -> bool:
    return (
        not is_comment_gone(comment)
        and is_comment_author(comment, viewer_id, visitor_key)
        and _age_seconds(comment, now) <= COMMENT_EDIT_WINDOW_SECONDS
    )


def can_delete_comment(
    comment: Mapping[str, Any],
    viewer_id: int | None,
    visitor_key: str | None,
    is_admin: bool,
    now: datetime,
) -> bool:
    if comment["deleted_at"] is not None:
        return False
    if is_admin and viewer_id is not None:
        return True
    return (
        comment["hidden_at"] is None
        and is_comment_author(comment, viewer_id, visitor_key)
        and _age_seconds(comment, now) <= COMMENT_DELETE_WINDOW_SECONDS
    )


def can_vote_comment(
    comment: Mapping[str, Any], viewer_id: int | None, visitor_key: str | None = None
) -> bool:
    return (
        viewer_id is not None
        and not is_comment_gone(comment)
        and not is_comment_author(comment, viewer_id, visitor_key)
    )


def can_report_comment(
    comment: Mapping[str, Any],
    viewer_id: int | None,
    visitor_key: str | None,
    *,
    anonymous_allowed: bool,
) -> bool:
    """Signed-in viewers, or anonymous visitors where the host allows anonymous comments (the
    visitor cookie is issued on the report if needed); never your own or a gone comment."""
    if viewer_id is None and not anonymous_allowed:
        return False
    return not is_comment_gone(comment) and not is_comment_author(comment, viewer_id, visitor_key)
