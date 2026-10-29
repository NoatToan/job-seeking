"""Opaque base64url-JSON cursors for the feed and live-search endpoints
(docs/product/FLOW_V2.md §3 "Cursor pagination"). Both raise `InvalidCursor` on anything
tampered with or malformed — including a right-shaped-but-wrong-typed payload — so the router
can turn that into `400 invalid_cursor`.
"""

import base64
import binascii
import json
from datetime import datetime
from typing import Any

#: Keys the live-search cursor may carry; one per source id accepted by `/api/search/live`.
SEARCH_SOURCE_IDS = ("seek", "himalayas", "remotive", "wwr", "arc")


class InvalidCursor(Exception):
    pass


def _encode(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_json(cursor: str) -> Any:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        return json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise InvalidCursor(str(exc)) from exc


def _is_plain_int(value: object) -> bool:
    """`True`/`False` are `int` in Python but must never pass as an id/page number."""
    return isinstance(value, int) and not isinstance(value, bool)


def encode_feed_cursor(t: datetime, i: int) -> str:
    return _encode({"t": t.isoformat(), "i": i})


def decode_feed_cursor(cursor: str) -> tuple[datetime, int]:
    data = _decode_json(cursor)
    if not isinstance(data, dict) or set(data) != {"t", "i"}:
        raise InvalidCursor("expected {t, i}")
    t_raw, i_raw = data["t"], data["i"]
    if not isinstance(t_raw, str) or not _is_plain_int(i_raw):
        raise InvalidCursor("wrong field types")
    try:
        t = datetime.fromisoformat(t_raw)
    except ValueError as exc:
        raise InvalidCursor("bad timestamp") from exc
    return t, i_raw


def encode_search_cursor(state: dict[str, int | None]) -> str:
    """Only encodes keys actually present in `state` — a source that was never requested (so
    never appears) stays absent, which `decode_search_cursor` treats as "not started yet" (page
    1), not exhausted. A source already fetched at least once that's `None` (single-page sources
    after their one page, or a paged source whose last page came back short) does encode, so it
    stays skipped on later calls even if `sources` is requested again."""
    return _encode({k: state[k] for k in SEARCH_SOURCE_IDS if k in state})


def decode_search_cursor(cursor: str) -> dict[str, int | None]:
    data = _decode_json(cursor)
    if not isinstance(data, dict):
        raise InvalidCursor("expected an object")
    state: dict[str, int | None] = {}
    for key in SEARCH_SOURCE_IDS:
        if key not in data:
            continue
        value = data[key]
        if value is not None and not _is_plain_int(value):
            raise InvalidCursor(f"bad value for {key}")
        state[key] = value
    return state
