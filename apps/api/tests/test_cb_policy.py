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
    assert not policy.can_vote(it)


@pytest.mark.parametrize("status", ["approved", "planned", "done"])
def test_public_statuses_visible_and_votable_by_everyone(status: str):
    it = item(status)
    assert policy.can_view(it, OTHER, False)
    assert policy.can_vote(it)
    assert not policy.can_view_context(it, OTHER, False)
    assert policy.can_view_context(it, AUTHOR, False)
    assert policy.can_view_context(it, ADMIN, True)


def test_delete_rules():
    assert policy.can_delete(item("new"), AUTHOR, False)
    assert not policy.can_delete(item("under_review"), AUTHOR, False)
    assert not policy.can_delete(item("new"), OTHER, False)
    assert policy.can_delete(item("done"), ADMIN, True)
