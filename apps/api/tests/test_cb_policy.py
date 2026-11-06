"""Authorisation rules as pure functions."""

import pytest

from contributor_box import policy

ADMIN, AUTHOR, OTHER = 1, 2, 3


def item(status: str) -> dict:
    return {"status": status, "author_id": AUTHOR}


@pytest.mark.parametrize("status", ["new", "under_review", "rejected"])
def test_private_statuses_visible_to_author_and_admin_only(status: str):
    it = item(status)
    assert policy.can_view(it, AUTHOR, False)
    assert policy.can_view(it, ADMIN, True)
    assert not policy.can_view(it, OTHER, False)
    assert not policy.can_vote(it, OTHER)


@pytest.mark.parametrize("status", ["approved", "planned", "done"])
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
    it = {"status": "new", "author_id": None}
    assert policy.is_anonymous(it)
    assert not policy.is_author(it, None)
    assert not policy.is_author(it, AUTHOR)
    assert not policy.can_view(it, OTHER, False)
    assert not policy.can_view(it, None, False)
    assert policy.can_view(it, ADMIN, True)
    assert not policy.can_view_context(it, None, False)
    assert not policy.can_delete(it, None, False)
    assert policy.can_delete(it, ADMIN, True)


def test_anonymous_viewer_is_never_the_author():
    assert not policy.is_author(item("new"), None)
    assert not policy.can_view(item("new"), None, False)
    assert policy.can_view(item("approved"), None, False)


@pytest.mark.parametrize("status", ["approved", "planned", "done"])
def test_signed_out_viewer_sees_public_items_without_context_and_never_votes(status: str):
    it = item(status)
    assert policy.can_view(it, None, False)
    assert not policy.can_view_context(it, None, False)
    assert not policy.can_vote(it, None)
    assert not policy.can_delete(it, None, False)


@pytest.mark.parametrize("status", ["new", "under_review", "rejected"])
def test_signed_out_viewer_never_sees_private_items(status: str):
    it = item(status)
    assert not policy.can_view(it, None, False)
    # Without a session nobody is an admin, even if a caller passes True by mistake.
    assert not policy.can_view(it, None, True)
    assert not policy.can_view_context(it, None, True)
    assert not policy.can_delete(it, None, True)
