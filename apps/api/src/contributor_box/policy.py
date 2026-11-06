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
"""

from collections.abc import Mapping
from typing import Any

from contributor_box.constants import PUBLIC_STATUSES


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
