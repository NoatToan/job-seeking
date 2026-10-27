"""Who may apply to a remote job, from its location text.

`open_to("Remote - US", True)` -> ["US"]; `open_to("Worldwide", True)` -> ["WORLDWIDE"];
`open_to("Remote", True)` -> None (unknown). Tokens are ISO country codes, "WORLDWIDE", or
regions (EUROPE, EMEA, APAC, ASIA, SEA, LATAM, NORTH_AMERICA, AMERICAS, OCEANIA, MIDDLE_EAST,
AFRICA). On-site jobs return None: they are about where the job is, not who may apply.
The web app keeps a remote job for a candidate when its tokens include WORLDWIDE, the country
or one of its regions (see CANDIDATE_COUNTRIES in packages/core), or when they are unknown.
"""

import re

WORLDWIDE = "WORLDWIDE"

_WORLDWIDE = re.compile(
    r"\b(worldwide|world[- ]wide|anywhere|global(ly)?|international|all countries|"
    r"work from anywhere|any location)\b"
)

REGIONS: dict[str, str] = {
    "europe": "EUROPE", "european union": "EUROPE", "eu": "EUROPE", "eea": "EUROPE",
    "emea": "EMEA", "apac": "APAC", "asia pacific": "APAC", "asia-pacific": "APAC",
    "asia": "ASIA", "southeast asia": "SEA", "south east asia": "SEA", "sea": "SEA",
    "latam": "LATAM", "latin america": "LATAM", "south america": "LATAM",
    "north america": "NORTH_AMERICA", "americas": "AMERICAS", "oceania": "OCEANIA",
    "middle east": "MIDDLE_EAST", "mena": "MIDDLE_EAST", "africa": "AFRICA",
}  # fmt: skip

COUNTRIES: dict[str, str] = {
    "united states": "US", "united states of america": "US", "usa": "US", "u.s.": "US",
    "u.s.a.": "US", "us": "US", "america": "US", "canada": "CA", "mexico": "MX",
    "united kingdom": "GB", "uk": "GB", "u.k.": "GB", "great britain": "GB", "england": "GB",
    "scotland": "GB", "ireland": "IE", "germany": "DE", "france": "FR", "spain": "ES",
    "portugal": "PT", "italy": "IT", "netherlands": "NL", "the netherlands": "NL",
    "belgium": "BE", "luxembourg": "LU", "switzerland": "CH", "austria": "AT",
    "denmark": "DK", "sweden": "SE", "norway": "NO", "finland": "FI", "iceland": "IS",
    "poland": "PL", "czechia": "CZ", "czech republic": "CZ", "slovakia": "SK",
    "hungary": "HU", "romania": "RO", "bulgaria": "BG", "greece": "GR", "croatia": "HR",
    "serbia": "RS", "slovenia": "SI", "estonia": "EE", "latvia": "LV", "lithuania": "LT",
    "ukraine": "UA", "turkey": "TR", "türkiye": "TR", "cyprus": "CY", "malta": "MT",
    "israel": "IL", "united arab emirates": "AE", "uae": "AE", "saudi arabia": "SA",
    "egypt": "EG", "south africa": "ZA", "nigeria": "NG", "kenya": "KE", "morocco": "MA",
    "india": "IN", "pakistan": "PK", "bangladesh": "BD", "sri lanka": "LK",
    "vietnam": "VN", "viet nam": "VN", "thailand": "TH", "malaysia": "MY",
    "singapore": "SG", "indonesia": "ID", "philippines": "PH", "cambodia": "KH",
    "china": "CN", "hong kong": "HK", "taiwan": "TW", "japan": "JP", "south korea": "KR",
    "korea": "KR", "australia": "AU", "new zealand": "NZ", "brazil": "BR",
    "argentina": "AR", "chile": "CL", "colombia": "CO", "peru": "PE", "uruguay": "UY",
    "costa rica": "CR", "ecuador": "EC", "bolivia": "BO", "paraguay": "PY",
    "guatemala": "GT", "armenia": "AM", "georgia": "GE", "azerbaijan": "AZ",
    "kazakhstan": "KZ", "uzbekistan": "UZ", "belarus": "BY", "moldova": "MD",
    "albania": "AL", "bosnia and herzegovina": "BA", "bosnia": "BA", "north macedonia": "MK",
    "montenegro": "ME", "andorra": "AD", "kosovo": "XK", "nepal": "NP", "mongolia": "MN",
    "venezuela": "VE", "nicaragua": "NI", "honduras": "HN", "el salvador": "SV", "belize": "BZ",
    "haiti": "HT", "jamaica": "JM", "papua new guinea": "PG", "qatar": "QA", "kuwait": "KW",
    "bahrain": "BH", "oman": "OM", "jordan": "JO", "lebanon": "LB", "tunisia": "TN",
    "algeria": "DZ", "ghana": "GH", "ethiopia": "ET", "uganda": "UG", "tanzania": "TZ",
    "rwanda": "RW", "panama": "PA", "dominican republic": "DO", "puerto rico": "PR",
}  # fmt: skip

CITIES: dict[str, str] = {
    "san francisco": "US", "new york": "US", "seattle": "US", "austin": "US",
    "boston": "US", "los angeles": "US", "chicago": "US", "denver": "US", "toronto": "CA",
    "vancouver": "CA", "montreal": "CA", "london": "GB", "manchester": "GB", "dublin": "IE",
    "berlin": "DE", "munich": "DE", "hamburg": "DE", "paris": "FR", "amsterdam": "NL",
    "madrid": "ES", "barcelona": "ES", "lisbon": "PT", "stockholm": "SE", "warsaw": "PL",
    "sydney": "AU", "melbourne": "AU", "brisbane": "AU", "perth": "AU", "auckland": "NZ",
    "ho chi minh": "VN", "hanoi": "VN", "ha noi": "VN", "da nang": "VN", "bangkok": "TH",
    "kuala lumpur": "MY", "jakarta": "ID", "manila": "PH", "tokyo": "JP", "seoul": "KR",
    "bangalore": "IN", "bengaluru": "IN", "hyderabad": "IN", "pune": "IN", "dubai": "AE",
    "tel aviv": "IL", "são paulo": "BR", "sao paulo": "BR", "buenos aires": "AR",
}  # fmt: skip

US_STATES = {
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
    "DC",
}
_ISO = set(COUNTRIES.values())

_NAMES = {**REGIONS, **COUNTRIES, **CITIES}
# longest names first so "south east asia" wins over "asia", "united states" over "us"
_NAME_RE = re.compile(
    r"(?<![a-z0-9])("
    + "|".join(re.escape(n) for n in sorted(_NAMES, key=len, reverse=True))
    + r")(?![a-z0-9])"
)
_CITY_STATE = re.compile(r"[A-Za-z][A-Za-z .'-]*,\s*([A-Z]{2})\b")
_PAREN_CODES = re.compile(r"\(\s*([A-Z]{2}(?:\s*[,/]\s*[A-Z]{2})*)\s*\)")
_CODE = re.compile(r"(?<![A-Za-z])([A-Z]{2})(?![A-Za-z])")


def _iso(code: str) -> str | None:
    code = "GB" if code == "UK" else code
    return code if code in _ISO else None


def _codes(text: str) -> set[str]:
    """Uppercase 2-letter codes: "Remote (US, CA)" -> US, CA; "San Francisco, CA" -> US."""
    paren = _PAREN_CODES.search(text)
    if paren:
        return {c for c in map(_iso, _CODE.findall(paren.group(1))) if c}
    found: set[str] = set()
    state_at: set[int] = set()
    for m in _CITY_STATE.finditer(text):
        if m.group(1) in US_STATES:
            found.add("US")
            state_at.add(m.start(1))
    for m in _CODE.finditer(text):
        if m.start(1) not in state_at and (code := _iso(m.group(1))):
            found.add(code)
    return found


def open_to(location: str | None, remote: bool, extra: list[str] | None = None) -> list[str] | None:
    if not remote:
        return None
    parts = [p for p in [location or "", *(extra or [])] if p and p.strip()]
    if not parts:
        return None
    tokens: set[str] = set()
    for part in parts:
        low = part.lower()
        if _WORLDWIDE.search(low):
            tokens.add(WORLDWIDE)
        for m in _NAME_RE.finditer(low):
            name = m.group(1)
            if name in ("us", "eu", "sea", "uk") and not re.search(
                rf"(?<![A-Za-z]){name.upper()}(?![A-Za-z])", part
            ):
                continue  # "us"/"sea" as lowercase words are English, not places
            tokens.add(_NAMES[name])
        if part.strip().upper() in _ISO:
            tokens.add(part.strip().upper())
        tokens |= _codes(part)
    if WORLDWIDE in tokens:
        return [WORLDWIDE]
    return sorted(tokens) or None


COUNTRY_REGIONS: dict[str, list[str]] = {
    "VN": ["APAC", "ASIA", "SEA"], "TH": ["APAC", "ASIA", "SEA"], "MY": ["APAC", "ASIA", "SEA"],
    "SG": ["APAC", "ASIA", "SEA"], "ID": ["APAC", "ASIA", "SEA"], "PH": ["APAC", "ASIA", "SEA"],
    "IN": ["APAC", "ASIA"], "JP": ["APAC", "ASIA"], "KR": ["APAC", "ASIA"],
    "AU": ["APAC", "OCEANIA"], "NZ": ["APAC", "OCEANIA"],
    "US": ["NORTH_AMERICA", "AMERICAS"], "CA": ["NORTH_AMERICA", "AMERICAS"],
    "MX": ["LATAM", "AMERICAS", "NORTH_AMERICA"], "BR": ["LATAM", "AMERICAS"],
    "AR": ["LATAM", "AMERICAS"], "GB": ["EUROPE", "EMEA"], "DE": ["EUROPE", "EMEA"],
    "FR": ["EUROPE", "EMEA"], "NL": ["EUROPE", "EMEA"], "ES": ["EUROPE", "EMEA"],
    "PL": ["EUROPE", "EMEA"],
}  # fmt: skip


def accepts(tokens: list[str] | None, candidate_country: str) -> bool | None:
    """True/False when the job's tokens say, None when unknown."""
    if tokens is None:
        return None
    ok = {WORLDWIDE, candidate_country, *COUNTRY_REGIONS.get(candidate_country, [])}
    return bool(ok & set(tokens))
