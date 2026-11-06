"""Row -> JSON (camelCase). What a viewer gets depends on `policy`: context fields (page URL,
selector, region, screenshot flag, user agent) only for the author and admins; the author's email
(or an anonymous submitter's chosen name) and internal notes only for admins. A signed-out viewer
(`viewer_id` None) gets the public fields only: `voted`, `isMine`, `canVote` and `canDelete` are
false, `context` and `author` null."""

from collections.abc import Mapping
from typing import Any

from contributor_box import policy
from contributor_box.repository import iso


def item_dto(item: Mapping[str, Any], viewer_id: int | None, is_admin: bool) -> dict[str, Any]:
    # Without a session nobody is an admin, whatever the caller passes.
    is_admin = is_admin and viewer_id is not None
    mine = policy.is_author(item, viewer_id)
    out: dict[str, Any] = {
        "id": str(item["id"]),
        "kind": item["kind"],
        "title": item["title"],
        "body": item["body"],
        "status": item["status"],
        "adminResponse": item["admin_response"],
        "voteCount": int(item["vote_count"]),
        "voted": viewer_id is not None and bool(item["voted"]),
        "isMine": mine,
        "canVote": policy.can_vote(item, viewer_id),
        "canDelete": policy.can_delete(item, viewer_id, is_admin),
        "createdAt": iso(item["created_at"]),
        "updatedAt": iso(item["updated_at"]),
        "statusChangedAt": iso(item["status_changed_at"]),
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
        out["author"] = {
            "id": None if anonymous else str(item["author_id"]),
            "email": None if anonymous else item.get("author_email"),
            "name": item.get("author_name"),
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
