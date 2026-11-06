"""Unit tests for `ujc_api.job_sort` (no database): sort validation, the per-zone gap table and
keyed cursors. Ordering and pagination against Postgres: test_job_sort_db.py."""

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from ujc_api.cursor import InvalidCursor, decode_sort_cursor, encode_sort_cursor
from ujc_api.job_sort import FEED_SORTS, PUBLIC_SORTS, decode_cursor, resolve_sort, zone_gaps

JULY = datetime(2026, 7, 1, 12, tzinfo=UTC)
JANUARY = datetime(2026, 1, 15, 12, tzinfo=UTC)
VIETNAM = 7 * 60


def test_default_sort_is_newest_with_no_key():
    plan = resolve_sort(None, None, allowed=PUBLIC_SORTS)
    assert plan.name == "newest"
    assert plan.key_sql is None


def test_score_is_the_old_name_of_match_and_match_is_feed_only():
    assert resolve_sort("score", None, allowed=FEED_SORTS).name == "match"
    with pytest.raises(HTTPException) as exc:
        resolve_sort("match", None, allowed=PUBLIC_SORTS)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_sort"


@pytest.mark.parametrize("tz", [None, "", "Not/AZone", "UTC+7"])
def test_timezone_sort_needs_a_valid_zone(tz):
    with pytest.raises(HTTPException) as exc:
        resolve_sort("timezone", tz, allowed=PUBLIC_SORTS)
    assert exc.value.detail["code"] == "invalid_timezone"


def test_zone_gaps_are_whole_hours_on_a_24h_circle():
    gaps = zone_gaps(VIETNAM, JANUARY)
    assert gaps["Asia/Ho_Chi_Minh"] == 0
    assert gaps["UTC+07:00"] == 0
    assert gaps["Asia/Tokyo"] == 2
    assert gaps["Asia/Kolkata"] == 1  # 90 minutes
    assert gaps["UTC-05:00"] == 12  # opposite side of the clock
    assert gaps["Pacific/Kiritimati"] == 7  # UTC+14: 7h ahead, not 17h behind
    assert gaps["UTC-12:00"] == 5  # 19h behind = 5h ahead on the circle


def test_zone_gaps_follow_daylight_saving():
    assert zone_gaps(VIETNAM, JANUARY)["Europe/Berlin"] == 6  # CET, UTC+1
    assert zone_gaps(VIETNAM, JULY)["Europe/Berlin"] == 5  # CEST, UTC+2


def test_sort_cursor_round_trips_and_rejects_wrong_types():
    t = datetime(2026, 10, 1, 9, 30, tzinfo=UTC)
    assert decode_sort_cursor(encode_sort_cursor("salary", 150000, t, 42)) == (
        "salary",
        150000,
        t,
        42,
    )
    with pytest.raises(InvalidCursor):
        decode_sort_cursor(encode_sort_cursor("salary", True, t, 42))


def test_cursor_from_another_sort_is_a_400():
    t = datetime(2026, 10, 1, tzinfo=UTC)
    salary = resolve_sort("salary", None, allowed=PUBLIC_SORTS)
    newest = resolve_sort(None, None, allowed=PUBLIC_SORTS)
    cursor = encode_sort_cursor("salary", 1, t, 1)
    assert decode_cursor(salary, cursor) == (1, t, 1)
    for plan, bad in ((newest, cursor), (salary, encode_sort_cursor("match", 1, t, 1))):
        with pytest.raises(HTTPException) as exc:
            decode_cursor(plan, bad)
        assert exc.value.detail["code"] == "invalid_cursor"
