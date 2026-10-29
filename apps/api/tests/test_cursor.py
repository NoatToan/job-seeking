from datetime import UTC, datetime

import pytest

from ujc_api.cursor import (
    InvalidCursor,
    decode_feed_cursor,
    decode_search_cursor,
    encode_feed_cursor,
    encode_search_cursor,
)


def test_feed_cursor_round_trips():
    t = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    cursor = encode_feed_cursor(t, 42)
    decoded_t, decoded_i = decode_feed_cursor(cursor)
    assert decoded_t == t
    assert decoded_i == 42


def test_feed_cursor_is_url_safe_base64_without_padding():
    cursor = encode_feed_cursor(datetime(2026, 1, 1, tzinfo=UTC), 1)
    assert "+" not in cursor and "/" not in cursor and "=" not in cursor


@pytest.mark.parametrize(
    "garbage",
    [
        "not-base64-json!!!",
        "e30=",  # base64 of "{}" - valid b64, wrong shape
    ],
)
def test_feed_cursor_tamper_raises_invalid_cursor(garbage):
    with pytest.raises(InvalidCursor):
        decode_feed_cursor(garbage)


def test_feed_cursor_wrong_field_types_raise_invalid_cursor():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"t": "2026-01-01", "i": "not-an-int"}).encode())
    with pytest.raises(InvalidCursor):
        decode_feed_cursor(bad.decode().rstrip("="))


def test_feed_cursor_rejects_bool_as_id():
    import base64
    import json

    payload = {"t": "2026-01-01T00:00:00+00:00", "i": True}
    bad = base64.urlsafe_b64encode(json.dumps(payload).encode())
    with pytest.raises(InvalidCursor):
        decode_feed_cursor(bad.decode().rstrip("="))


def test_search_cursor_round_trips():
    state = {"seek": 2, "himalayas": 2, "remotive": None, "wwr": None, "arc": None}
    cursor = encode_search_cursor(state)
    assert decode_search_cursor(cursor) == state


def test_search_cursor_omits_keys_never_set():
    cursor = encode_search_cursor({"seek": 2})
    decoded = decode_search_cursor(cursor)
    assert decoded == {"seek": 2}
    assert "arc" not in decoded


def test_search_cursor_tamper_raises_invalid_cursor():
    with pytest.raises(InvalidCursor):
        decode_search_cursor("%%%not valid base64%%%")


def test_search_cursor_rejects_non_int_page():
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"seek": "two"}).encode())
    with pytest.raises(InvalidCursor):
        decode_search_cursor(bad.decode().rstrip("="))
