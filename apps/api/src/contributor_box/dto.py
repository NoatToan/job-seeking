"""Row -> JSON (camelCase). What a viewer gets depends on `policy`: context fields (page URL,
selector, region, screenshot flag, user agent) only for the author and admins; the author's email
and internal notes only for admins. Everyone gets the public `byline` (display name or
pseudonym, never an email). A signed-out viewer (`viewer_id` None) gets the public fields only:
`myVote` 0, `canVote` and `canDelete` false, `context` and `author` null."""

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from contributor_box import policy
from contributor_box.identity import public_author, visitor_label
from contributor_box.repository import iso


def item_byline(item: Mapping[str, Any]) -> dict[str, Any] | None:
    """Public author of an item. Legacy anonymous rows (before visitor identities) have no
    visitor key: they show their typed name, or nothing ("Anonymous" in the UI)."""
    if item["author_id"] is None and item.get("visitor_key") is None:
        name = item.get("author_name")
        if not name:
            return None
        return {
            "kind": "guest",
            "name": name,
            "pseudonym": None,
            "tag": None,
            "avatar": {"glyph": name[:1].upper(), "tone": 0},
            "team": False,
        }
    return public_author(
        user_id=item["author_id"],
        email=item.get("author_email"),
        user_name=item.get("author_display_name"),
        visitor_key=item.get("visitor_key"),
        visitor_name=item.get("visitor_display_name"),
    )


def item_dto(
    item: Mapping[str, Any],
    viewer_id: int | None,
    is_admin: bool,
    *,
    visitor_key: str | None = None,
) -> dict[str, Any]:
    # Without a session nobody is an admin, whatever the caller passes.
    is_admin = is_admin and viewer_id is not None
    mine = policy.is_author(item, viewer_id) or (
        viewer_id is None
        and visitor_key is not None
        and item.get("visitor_key") is not None
        and item.get("visitor_key") == visitor_key
    )
    my_vote = int(item["my_vote"]) if viewer_id is not None else 0
    out: dict[str, Any] = {
        "id": str(item["id"]),
        "kind": item["kind"],
        "title": item["title"],
        "body": item["body"],
        "status": item["status"],
        "adminResponse": item["admin_response"],
        "score": int(item["score"]),
        "upvotes": int(item["upvotes"]),
        "downvotes": int(item["downvotes"]),
        "myVote": my_vote,
        "commentCount": int(item["comment_count"]),
        "commentsLocked": bool(item["comments_locked"]),
        "isMine": mine,
        "canVote": policy.can_vote(item, viewer_id),
        "canDelete": policy.can_delete(item, viewer_id, is_admin),
        "createdAt": iso(item["created_at"]),
        "updatedAt": iso(item["updated_at"]),
        "statusChangedAt": iso(item["status_changed_at"]),
        "byline": item_byline(item),
        "context": None,
        "author": None,
    }
    if policy.can_view_context(item, viewer_id, is_admin):
        out["context"] = {
            "pageUrl": item["page_url"],
            "pageTitle": item["page_title"],
            "elementSelector": item["element_selector"],
            "elementText": item["element_text"],
            "region": item["region"],
            "viewportWidth": item["viewport_width"],
            "viewportHeight": item["viewport_height"],
            "hasScreenshot": bool(item["has_screenshot"]),
            "userAgent": item["user_agent"] if is_admin else None,
        }
    if is_admin:
        anonymous = policy.is_anonymous(item)
        name = item.get("author_name")
        if anonymous and item.get("visitor_key"):
            name = visitor_label(item["visitor_key"], item.get("visitor_display_name"))
        out["author"] = {
            "id": None if anonymous else str(item["author_id"]),
            "email": None if anonymous else item.get("author_email"),
            "name": name,
            "anonymous": anonymous,
        }
    return out


def note_dto(note: Mapping[str, Any], is_admin: bool) -> dict[str, Any]:
    return {
        "id": str(note["id"]),
        "kind": note["kind"],
        "visibility": note["visibility"],
        "body": note["body"],
        "fromStatus": note["from_status"],
        "toStatus": note["to_status"],
        "createdAt": iso(note["created_at"]),
        # Only admins see which admin wrote what; everyone else sees "the team".
        "authorEmail": note.get("author_email") if is_admin else None,
    }


def comment_dto(
    comment: Mapping[str, Any],
    *,
    item: Mapping[str, Any],
    viewer_id: int | None,
    visitor_key: str | None,
    is_admin: bool,
    anonymous_allowed: bool,
    now: datetime | None = None,
) -> dict[str, Any]:
    """A comment as a viewer sees it. Deleted ones are placeholders ("[deleted]": no body, no
    author); hidden ones are placeholders for everyone but admins, who see the words and a
    `hidden` flag."""
    now = now or datetime.now(UTC)
    is_admin = is_admin and viewer_id is not None
    deleted = comment["deleted_at"] is not None
    hidden = comment["hidden_at"] is not None
    placeholder = deleted or (hidden and not is_admin)
    mine = policy.is_comment_author(comment, viewer_id, visitor_key)
    item_open = policy.can_comment(item, viewer_id, is_admin, anonymous_allowed=anonymous_allowed)
    out: dict[str, Any] = {
        "id": str(comment["id"]),
        "parentId": str(comment["parent_id"]) if comment["parent_id"] is not None else None,
        "body": None if placeholder else comment["body"],
        "deleted": deleted,
        "hidden": hidden,
        "author": None
        if placeholder
        else public_author(
            user_id=comment["author_id"],
            email=comment.get("author_email"),
            user_name=comment.get("user_display_name"),
            visitor_key=comment["visitor_key"],
            visitor_name=comment.get("visitor_display_name"),
            by_team=comment["by_team"],
        ),
        "createdAt": iso(comment["created_at"]),
        "editedAt": iso(comment["edited_at"]),
        "score": 0 if placeholder else int(comment["score"]),
        "upvotes": 0 if placeholder else int(comment["upvotes"]),
        "downvotes": 0 if placeholder else int(comment["downvotes"]),
        "myVote": int(comment["my_vote"]) if viewer_id is not None and not placeholder else 0,
        "isMine": mine and not placeholder,
        "canEdit": policy.can_edit_comment(comment, viewer_id, visitor_key, now),
        "canDelete": policy.can_delete_comment(comment, viewer_id, visitor_key, is_admin, now),
        "canVote": policy.can_vote_comment(comment, viewer_id, visitor_key),
        "canReply": item_open and not placeholder,
        "canReport": not is_admin
        and policy.can_report_comment(
            comment, viewer_id, visitor_key, anonymous_allowed=anonymous_allowed
        ),
        "canModerate": is_admin and not deleted,
        "reportCount": int(comment.get("report_count") or 0) if is_admin else None,
    }
    if comment["parent_id"] is None:
        out["replyCount"] = int(comment.get("reply_count") or 0)
    return out
