"""Per-user `GET /api/search/live` rate limit (30/min). Exercises
`_rate_limited_live_search_user` directly (a plain function, called the same way FastAPI's
dependency injection would) rather than over HTTP, so the test needs no database: the route
itself depends on a live Postgres connection for the rest of its body."""

import pytest
from fastapi import HTTPException

from ujc_api.auth.deps import AuthedUser
from ujc_api.rate_limit import LIVE_SEARCH_LIMIT, LIVE_SEARCH_WINDOW_SECONDS
from ujc_api.routers.search import _rate_limited_live_search_user


def test_allows_up_to_the_limit_then_429s():
    user = AuthedUser(id=1, email="a@example.com")
    for _ in range(LIVE_SEARCH_LIMIT):
        assert _rate_limited_live_search_user(user) is user

    with pytest.raises(HTTPException) as exc_info:
        _rate_limited_live_search_user(user)
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["code"] == "rate_limited"
    assert exc_info.value.headers["Retry-After"] == str(int(LIVE_SEARCH_WINDOW_SECONDS))


def test_limit_is_keyed_per_user_not_globally():
    user_a = AuthedUser(id=1, email="a@example.com")
    user_b = AuthedUser(id=2, email="b@example.com")
    for _ in range(LIVE_SEARCH_LIMIT):
        _rate_limited_live_search_user(user_a)
    with pytest.raises(HTTPException):
        _rate_limited_live_search_user(user_a)

    # A different user still has their own budget.
    assert _rate_limited_live_search_user(user_b) is user_b
