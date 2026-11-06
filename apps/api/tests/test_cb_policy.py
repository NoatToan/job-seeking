"""Authorisation rules as pure functions."""

from datetime import UTC, datetime, timedelta

import pytest

from contributor_box import policy
from contributor_box.constants import COMMENT_DELETE_WINDOW_SECONDS, COMMENT_EDIT_WINDOW_SECONDS

ADMIN, AUTHOR, OTHER = 1, 2, 3
PUBLIC = ["new", "under_review", "approved", "planned", "done"]
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def item(status: str, *, locked: bool = False) -> dict:
    return {"status": status, "author_id": AUTHOR, "comments_locked": locked}


def test_rejected_is_visible_to_author_and_admin_only():
    it = item("rejected")
    assert policy.can_view(it, AUTHOR, False)
    assert policy.can_view(it, ADMIN, True)
    assert not policy.can_view(it, OTHER, False)
    assert not policy.can_vote(it, OTHER)


@pytest.mark.parametrize("status", PUBLIC)
def test_public_statuses_visible_and_votable_by_everyone(status: str):
    it = item(status)
    assert policy.can_view(it, OTHER, False)
    assert policy.can_vote(it, OTHER)
    assert not policy.can_view_context(it, OTHER, False)
    assert policy.can_view_context(it, AUTHOR, False)
    assert policy.can_view_context(it, ADMIN, True)


def test_delete_rules():
    assert policy.can_delete(item("new"), AUTHOR, False)
    assert not policy.can_delete(item("under_review"), AUTHOR, False)
    assert not policy.can_delete(item("new"), OTHER, False)
    assert policy.can_delete(item("done"), ADMIN, True)


def test_anonymous_items_have_no_author():
    it = {"status": "rejected", "author_id": None}
    assert policy.is_anonymous(it)
    assert not policy.is_author(it, None)
    assert not policy.is_author(it, AUTHOR)
    assert not policy.can_view(it, OTHER, False)
    assert not policy.can_view(it, None, False)
    assert policy.can_view(it, ADMIN, True)
    assert not policy.can_view_context(it, None, False)
    assert not policy.can_delete(it, None, False)
    assert policy.can_delete(it, ADMIN, True)


@pytest.mark.parametrize("status", PUBLIC)
def test_signed_out_viewer_sees_public_items_without_context_and_never_votes(status: str):
    it = item(status)
    assert policy.can_view(it, None, False)
    assert not policy.can_view_context(it, None, False)
    assert not policy.can_vote(it, None)
    assert not policy.can_delete(it, None, False)


def test_signed_out_viewer_never_sees_rejected_items():
    it = item("rejected")
    assert not policy.can_view(it, None, False)
    # Without a session nobody is an admin, even if a caller passes True by mistake.
    assert not policy.can_view(it, None, True)
    assert not policy.can_view_context(it, None, True)
    assert not policy.can_delete(it, None, True)


# --- comments ------------------------------------------------------------------------------------


def comment(
    *,
    author_id: int | None = AUTHOR,
    visitor_key: str | None = None,
    age: float = 0,
    deleted: bool = False,
    hidden: bool = False,
) -> dict:
    return {
        "author_id": None if visitor_key else author_id,
        "visitor_key": visitor_key,
        "created_at": NOW - timedelta(seconds=age),
        "deleted_at": NOW if deleted else None,
        "hidden_at": NOW if hidden else None,
    }


def test_comments_readable_by_whoever_sees_the_item():
    assert policy.can_read_comments(item("new"), None, False)
    assert not policy.can_read_comments(item("rejected"), OTHER, False)
    assert policy.can_read_comments(item("rejected"), AUTHOR, False)
    assert policy.can_read_comments(item("rejected"), ADMIN, True)


def test_can_comment():
    open_item, locked = item("planned"), item("planned", locked=True)
    assert policy.can_comment(open_item, OTHER, False, anonymous_allowed=False)
    assert not policy.can_comment(locked, OTHER, False, anonymous_allowed=False)
    assert policy.can_comment(locked, ADMIN, True, anonymous_allowed=False)
    # Signed out: only when the host allows it, only on public, unlocked items.
    assert not policy.can_comment(open_item, None, False, anonymous_allowed=False)
    assert policy.can_comment(open_item, None, False, anonymous_allowed=True)
    assert not policy.can_comment(locked, None, False, anonymous_allowed=True)
    assert not policy.can_comment(item("rejected"), None, True, anonymous_allowed=True)
    # Private item: its author and admins.
    assert policy.can_comment(item("rejected"), AUTHOR, False, anonymous_allowed=True)
    assert not policy.can_comment(item("rejected"), OTHER, False, anonymous_allowed=True)


def test_edit_window_and_ownership():
    assert policy.can_edit_comment(comment(), AUTHOR, None, NOW)
    assert policy.can_edit_comment(comment(age=COMMENT_EDIT_WINDOW_SECONDS), AUTHOR, None, NOW)
    late = comment(age=COMMENT_EDIT_WINDOW_SECONDS + 1)
    assert not policy.can_edit_comment(late, AUTHOR, None, NOW)
    assert not policy.can_edit_comment(comment(), OTHER, None, NOW)
    # Admins never edit someone else's words.
    assert not policy.can_edit_comment(comment(), ADMIN, None, NOW)
    assert not policy.can_edit_comment(comment(hidden=True), AUTHOR, None, NOW)


def test_visitor_owns_by_key_only_when_signed_out():
    c = comment(visitor_key="k1")
    assert policy.can_edit_comment(c, None, "k1", NOW)
    assert not policy.can_edit_comment(c, None, "k2", NOW)
    assert not policy.can_edit_comment(c, None, None, NOW)
    # A signed-in viewer is identified by account, never by a leftover visitor cookie.
    assert not policy.can_edit_comment(c, OTHER, "k1", NOW)


def test_delete_window_and_admin_override():
    old = comment(age=COMMENT_DELETE_WINDOW_SECONDS + 1)
    assert policy.can_delete_comment(comment(age=3600), AUTHOR, None, False, NOW)
    assert not policy.can_delete_comment(old, AUTHOR, None, False, NOW)
    assert policy.can_delete_comment(old, ADMIN, None, True, NOW)
    assert policy.can_delete_comment(comment(hidden=True), ADMIN, None, True, NOW)
    assert not policy.can_delete_comment(comment(hidden=True), AUTHOR, None, False, NOW)
    assert not policy.can_delete_comment(comment(deleted=True), ADMIN, None, True, NOW)
    # "Admin" without a session is nobody.
    assert not policy.can_delete_comment(old, None, None, True, NOW)


def test_comment_votes_need_a_session_and_not_your_own():
    assert policy.can_vote_comment(comment(), OTHER)
    assert not policy.can_vote_comment(comment(), AUTHOR)
    assert not policy.can_vote_comment(comment(), None)
    assert not policy.can_vote_comment(comment(deleted=True), OTHER)
    assert not policy.can_vote_comment(comment(hidden=True), OTHER)


def test_reports():
    c = comment()
    assert policy.can_report_comment(c, OTHER, None, anonymous_allowed=False)
    assert not policy.can_report_comment(c, AUTHOR, None, anonymous_allowed=False)
    assert not policy.can_report_comment(c, None, None, anonymous_allowed=False)
    assert policy.can_report_comment(c, None, "k", anonymous_allowed=True)
    assert not policy.can_report_comment(
        comment(visitor_key="k"), None, "k", anonymous_allowed=True
    )
    assert not policy.can_report_comment(comment(deleted=True), OTHER, None, anonymous_allowed=True)
