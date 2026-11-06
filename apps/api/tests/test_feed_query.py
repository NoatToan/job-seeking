from ujc_api.feed_query import (
    MAX_POSTED_WITHIN_HOURS,
    POSTED_WITHIN_CLAUSE,
    POSTED_WITHIN_HOURS_CLAUSE,
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
