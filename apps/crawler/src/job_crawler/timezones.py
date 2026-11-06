"""Which time zone(s) a job works in, so the web app can compare its hours with the user's.

`job_timezones(location, description, remote, extra, raw)` -> (zones, source) or (None, None).

Zones are IANA names ("America/New_York") or fixed offsets written "UTC+07:00" / "UTC-05:30".
A list means "any of these" (a remote job open to UTC-8 … UTC-5, or a country spanning several
zones); the first entry is the primary one. `source` says how sure we are:

- "stated"   — the posting says it (Himalayas `timezoneRestrictions`, "UTC+7", "EST hours", …)
- "location" — inferred from where the job is (city, US state, country, region)

Worldwide / anywhere jobs and locations we can't place return (None, None): no constraint known.
"""

import re
from typing import Any

from job_crawler import eligibility

STATED = "stated"
LOCATION = "location"

# Abbreviations matched case-sensitively as whole words (so "est." in Spanish or "art" don't hit).
_ABBREVIATIONS: dict[str, str] = {
    "EST": "America/New_York", "EDT": "America/New_York",
    "CST": "America/Chicago", "CDT": "America/Chicago",
    "MST": "America/Denver", "MDT": "America/Denver",
    "PST": "America/Los_Angeles", "PDT": "America/Los_Angeles",
    "AKST": "America/Anchorage", "HST": "Pacific/Honolulu",
    "BST": "Europe/London", "WET": "Europe/Lisbon",
    "CET": "Europe/Berlin", "CEST": "Europe/Berlin",
    "EET": "Europe/Athens", "EEST": "Europe/Athens",
    "MSK": "Europe/Moscow", "GST": "Asia/Dubai", "IST": "Asia/Kolkata",
    "PKT": "Asia/Karachi", "ICT": "Asia/Ho_Chi_Minh", "WIB": "Asia/Jakarta",
    "SGT": "Asia/Singapore", "HKT": "Asia/Hong_Kong", "PHT": "Asia/Manila",
    "JST": "Asia/Tokyo", "KST": "Asia/Seoul",
    "AWST": "Australia/Perth", "ACST": "Australia/Adelaide",
    "AEST": "Australia/Sydney", "AEDT": "Australia/Sydney",
    "NZST": "Pacific/Auckland", "NZDT": "Pacific/Auckland",
    "BRT": "America/Sao_Paulo",
}  # fmt: skip
_ABBR_RE = re.compile(
    r"(?<![A-Za-z])(" + "|".join(sorted(_ABBREVIATIONS, key=len, reverse=True)) + r")(?![A-Za-z])"
)

_PHRASES: dict[str, str] = {
    "eastern time": "America/New_York", "eastern standard time": "America/New_York",
    "central time": "America/Chicago", "mountain time": "America/Denver",
    "pacific time": "America/Los_Angeles", "pacific standard time": "America/Los_Angeles",
    "central european time": "Europe/Berlin", "eastern european time": "Europe/Athens",
    "uk time": "Europe/London", "london time": "Europe/London",
    "indochina time": "Asia/Ho_Chi_Minh", "vietnam time": "Asia/Ho_Chi_Minh",
    "singapore time": "Asia/Singapore", "india standard time": "Asia/Kolkata",
    "japan standard time": "Asia/Tokyo", "australian eastern time": "Australia/Sydney",
}  # fmt: skip
_PHRASE_RE = re.compile(
    r"\b(" + "|".join(re.escape(p) for p in sorted(_PHRASES, key=len, reverse=True)) + r")\b"
)

_SIGN = r"[+\-−–]"
_OFFSET = rf"(?:UTC|GMT)\s*({_SIGN})\s*(\d{{1,2}})(?::?([0-5]\d))?"
_OFFSET_RE = re.compile(_OFFSET, re.IGNORECASE)
# "UTC-5 to UTC+1", "GMT-3 – GMT+2", "UTC−8 and UTC−5", "between UTC+5 and +9"
_RANGE_RE = re.compile(
    rf"{_OFFSET}\s*(?:to|until|through|and|-|–|—|/)\s*(?:UTC|GMT)?\s*({_SIGN})\s*(\d{{1,2}})(?::?([0-5]\d))?",
    re.IGNORECASE,
)

# Cities / US states / countries that sit in one zone (or, for big countries, its main ones).
CITY_ZONES: dict[str, str] = {
    "san francisco": "America/Los_Angeles", "los angeles": "America/Los_Angeles",
    "seattle": "America/Los_Angeles", "portland": "America/Los_Angeles",
    "san diego": "America/Los_Angeles", "san jose": "America/Los_Angeles",
    "denver": "America/Denver", "phoenix": "America/Phoenix", "chicago": "America/Chicago",
    "austin": "America/Chicago", "dallas": "America/Chicago", "houston": "America/Chicago",
    "new york": "America/New_York", "boston": "America/New_York", "miami": "America/New_York",
    "atlanta": "America/New_York",
    "toronto": "America/Toronto", "montreal": "America/Toronto", "ottawa": "America/Toronto",
    "vancouver": "America/Vancouver", "calgary": "America/Edmonton",
    "perth": "Australia/Perth", "adelaide": "Australia/Adelaide", "brisbane": "Australia/Brisbane",
    "sydney": "Australia/Sydney", "melbourne": "Australia/Melbourne",
    "são paulo": "America/Sao_Paulo", "sao paulo": "America/Sao_Paulo",
}  # fmt: skip
_CITY_RE = re.compile(
    r"\b(" + "|".join(re.escape(c) for c in sorted(CITY_ZONES, key=len, reverse=True)) + r")\b"
)

_CITY_STATE = re.compile(r"[A-Za-z][A-Za-z .'-]*,\s*([A-Z]{2})\b")
_PACIFIC = {"WA", "OR", "CA", "NV"}
_MOUNTAIN = {"MT", "ID", "WY", "UT", "CO", "NM"}
_CENTRAL = {
    "ND", "SD", "NE", "KS", "OK", "TX", "MN", "IA", "MO", "AR", "LA", "WI", "IL", "MS", "AL", "TN",
}  # fmt: skip


def _state_zone(state: str) -> str:
    if state == "AZ":
        return "America/Phoenix"
    if state == "AK":
        return "America/Anchorage"
    if state == "HI":
        return "Pacific/Honolulu"
    if state in _PACIFIC:
        return "America/Los_Angeles"
    if state in _MOUNTAIN:
        return "America/Denver"
    if state in _CENTRAL:
        return "America/Chicago"
    return "America/New_York"


COUNTRY_ZONES: dict[str, list[str]] = {
    "US": ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
    "CA": ["America/Toronto", "America/Vancouver"], "MX": ["America/Mexico_City"],
    "BR": ["America/Sao_Paulo"], "AR": ["America/Argentina/Buenos_Aires"],
    "CL": ["America/Santiago"], "CO": ["America/Bogota"], "PE": ["America/Lima"],
    "UY": ["America/Montevideo"], "CR": ["America/Costa_Rica"], "EC": ["America/Guayaquil"],
    "GB": ["Europe/London"], "IE": ["Europe/Dublin"], "PT": ["Europe/Lisbon"],
    "ES": ["Europe/Madrid"], "FR": ["Europe/Paris"], "DE": ["Europe/Berlin"],
    "NL": ["Europe/Amsterdam"], "BE": ["Europe/Brussels"], "CH": ["Europe/Zurich"],
    "AT": ["Europe/Vienna"], "IT": ["Europe/Rome"], "DK": ["Europe/Copenhagen"],
    "SE": ["Europe/Stockholm"], "NO": ["Europe/Oslo"], "FI": ["Europe/Helsinki"],
    "PL": ["Europe/Warsaw"], "CZ": ["Europe/Prague"], "HU": ["Europe/Budapest"],
    "RO": ["Europe/Bucharest"], "BG": ["Europe/Sofia"], "GR": ["Europe/Athens"],
    "HR": ["Europe/Zagreb"], "RS": ["Europe/Belgrade"], "EE": ["Europe/Tallinn"],
    "LV": ["Europe/Riga"], "LT": ["Europe/Vilnius"], "UA": ["Europe/Kyiv"],
    "TR": ["Europe/Istanbul"], "IL": ["Asia/Jerusalem"], "AE": ["Asia/Dubai"],
    "SA": ["Asia/Riyadh"], "EG": ["Africa/Cairo"], "ZA": ["Africa/Johannesburg"],
    "NG": ["Africa/Lagos"], "KE": ["Africa/Nairobi"], "IN": ["Asia/Kolkata"],
    "PK": ["Asia/Karachi"], "BD": ["Asia/Dhaka"], "LK": ["Asia/Colombo"],
    "VN": ["Asia/Ho_Chi_Minh"], "TH": ["Asia/Bangkok"], "MY": ["Asia/Kuala_Lumpur"],
    "SG": ["Asia/Singapore"], "ID": ["Asia/Jakarta"], "PH": ["Asia/Manila"],
    "CN": ["Asia/Shanghai"], "HK": ["Asia/Hong_Kong"], "TW": ["Asia/Taipei"],
    "JP": ["Asia/Tokyo"], "KR": ["Asia/Seoul"],
    "AU": ["Australia/Sydney", "Australia/Perth"], "NZ": ["Pacific/Auckland"],
}  # fmt: skip

REGION_ZONES: dict[str, list[str]] = {
    "EUROPE": ["Europe/London", "Europe/Berlin", "Europe/Athens"],
    "EMEA": ["Europe/London", "Europe/Berlin", "Asia/Dubai"],
    "NORTH_AMERICA": ["America/New_York", "America/Los_Angeles"],
    "LATAM": ["America/Mexico_City", "America/Sao_Paulo"],
    "AMERICAS": ["America/New_York", "America/Los_Angeles", "America/Sao_Paulo"],
    "APAC": ["Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"],
    "ASIA": ["Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo"],
    "SEA": ["Asia/Bangkok", "Asia/Singapore"],
    "OCEANIA": ["Australia/Sydney", "Pacific/Auckland"],
    "MIDDLE_EAST": ["Asia/Dubai"],
    "AFRICA": ["Africa/Lagos", "Africa/Johannesburg"],
}  # fmt: skip

_MAX_OFFSET_MIN = 14 * 60


def format_offset(minutes: int) -> str:
    """-330 -> "UTC-05:30"."""
    sign = "+" if minutes >= 0 else "-"
    h, m = divmod(abs(minutes), 60)
    return f"UTC{sign}{h:02d}:{m:02d}"


def _minutes(sign: str, hours: str, mins: str | None) -> int | None:
    value = int(hours) * 60 + int(mins or 0)
    value = value if sign == "+" else -value
    return value if abs(value) <= _MAX_OFFSET_MIN else None


def _offset_range(lo: int, hi: int) -> list[str]:
    """Every whole hour from lo to hi (inclusive), keeping lo/hi exactly."""
    lo, hi = min(lo, hi), max(lo, hi)
    hours = range(lo // 60 + (1 if lo % 60 else 0), hi // 60 + 1)
    values = sorted({lo, hi, *(h * 60 for h in hours if lo <= h * 60 <= hi)})
    return [format_offset(v) for v in values]


def _add(zones: list[str], new: list[str]) -> None:
    for z in new:
        if z not in zones:
            zones.append(z)


def _structured(raw: dict[str, Any] | None) -> list[str]:
    """Himalayas `timezoneRestrictions`: UTC offsets in hours, e.g. [-8, -7, -6, -5]."""
    values = (raw or {}).get("timezoneRestrictions")
    if not isinstance(values, list):
        return []
    minutes = []
    for v in values:
        try:
            m = round(float(v) * 60)
        except (TypeError, ValueError):
            continue
        if abs(m) <= _MAX_OFFSET_MIN:
            minutes.append(m)
    if not minutes:
        return []
    return (
        _offset_range(min(minutes), max(minutes))
        if len(minutes) > 1
        else [format_offset(minutes[0])]
    )


def stated_timezones(text: str | None) -> list[str]:
    """Zones a posting names explicitly ("UTC-5 to UTC+1", "EST", "Pacific Time")."""
    if not text:
        return []
    zones: list[str] = []
    found: list[tuple[int, list[str]]] = []
    ranged_spans: list[tuple[int, int]] = []
    for m in _RANGE_RE.finditer(text):
        a = _minutes("-" if m.group(1) != "+" else "+", m.group(2), m.group(3))
        b = _minutes("-" if m.group(4) != "+" else "+", m.group(5), m.group(6))
        if a is not None and b is not None and abs(a - b) <= 12 * 60:
            found.append((m.start(), _offset_range(a, b)))
            ranged_spans.append(m.span())
    for m in _OFFSET_RE.finditer(text):
        if any(s <= m.start() < e for s, e in ranged_spans):
            continue
        v = _minutes("-" if m.group(1) != "+" else "+", m.group(2), m.group(3))
        if v is not None:
            found.append((m.start(), [format_offset(v)]))
    for m in _ABBR_RE.finditer(text):
        found.append((m.start(), [_ABBREVIATIONS[m.group(1)]]))
    for m in _PHRASE_RE.finditer(text.lower()):
        found.append((m.start(), [_PHRASES[m.group(1)]]))
    for _, z in sorted(found, key=lambda f: f[0]):
        _add(zones, z)
    return zones


def location_timezones(location: str | None, extra: list[str] | None = None) -> list[str]:
    """Zones implied by where the job is: city, US state, country or region."""
    if not location and not extra:
        return []
    zones: list[str] = []
    for part in [location or "", *(extra or [])]:
        for m in _CITY_RE.finditer(part.lower()):
            _add(zones, [CITY_ZONES[m.group(1)]])
        for m in _CITY_STATE.finditer(part):
            state = m.group(1)
            # "Toronto, CA" is Canada, not California.
            if state in eligibility.US_STATES and not (state == "CA" and "canada" in part.lower()):
                _add(zones, [_state_zone(state)])
    if zones:
        return zones
    tokens = eligibility.open_to(location, True, extra) or []
    if eligibility.WORLDWIDE in tokens:
        return []
    for token in tokens:
        _add(zones, COUNTRY_ZONES.get(token, []))
    if not zones:
        for token in tokens:
            _add(zones, REGION_ZONES.get(token, []))
    return zones


def job_timezones(
    location: str | None,
    description: str | None,
    extra: list[str] | None = None,
    raw: dict[str, Any] | None = None,
) -> tuple[list[str] | None, str | None]:
    zones = _structured(raw)
    if not zones:
        zones = stated_timezones(location) or stated_timezones(description)
    if zones:
        return zones, STATED
    zones = location_timezones(location, extra)
    return (zones, LOCATION) if zones else (None, None)
