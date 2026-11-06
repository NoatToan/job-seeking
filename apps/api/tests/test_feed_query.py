from ujc_api.feed_query import (
    MAX_POSTED_WITHIN_HOURS,
    POSTED_WITHIN_CLAUSE,
    POSTED_WITHIN_HOURS_CLAUSE,
    access_clause,
    posted_within_clause,
)


def test_posted_within_none_without_days_or_hours() -> None:
    assert posted_within_clause(None, None) is None


def test_posted_within_days() -> None:
    assert posted_within_clause(7, None) == (POSTED_WITHIN_CLAUSE, 7)


def test_posted_within_hours_wins_over_days() -> None:
    assert posted_within_clause(7, 1) == (POSTED_WITHIN_HOURS_CLAUSE, 1)


def test_posted_within_hours_is_clamped() -> None:
    assert posted_within_clause(None, 10_000) == (
        POSTED_WITHIN_HOURS_CLAUSE,
        MAX_POSTED_WITHIN_HOURS,
    )
    assert posted_within_clause(None, -3) == (POSTED_WITHIN_HOURS_CLAUSE, 1)


def test_access_clause_off_without_mode() -> None:
    assert access_clause(None, "VN") is None
    assert access_clause("bogus", "VN") is None


def test_access_clause_open_keeps_unknown_and_onsite() -> None:
    clause, tokens = access_clause("open", "vn")
    assert "open_to IS NULL" in clause and "NOT remote" in clause
    assert tokens == ["WORLDWIDE", "VN", "APAC", "ASIA", "SEA"]


def test_access_clause_confirmed_needs_a_stated_region() -> None:
    clause, tokens = access_clause("confirmed", None)
    assert "IS NULL" not in clause
    assert tokens == ["WORLDWIDE"]
