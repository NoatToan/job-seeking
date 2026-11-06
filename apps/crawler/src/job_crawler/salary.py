"""A structured salary pulled out of free text (job title + description, or a short salary string).

`parse_salary("$120k - $150k a year")` -> Salary(120000.0, 150000.0, "USD", "year");
`parse_salary("Lương 20-30 triệu")` -> Salary(20000000.0, 30000000.0, "VND", "month");
`parse_salary("We raised $50M")` -> None.

The first plausible mention wins. Amounts are in currency units per `period` ("year", "month",
"week", "day", "hour"); `currency` is an ISO 4217 code, or None when the text gives none (we then
only accept an amount that is clearly money: a "/hr"-style period or a "120k"-style suffix).
"up to X" sets only `max`, "from X" / "X+" only `min`; a single amount sets both. With no period
word the period is guessed from the size of the amount (120,000 -> year, 5,000 -> month, 45 ->
hour), using per-currency thresholds for VND / INR / JPY. Funding rounds, user counts, 401k,
percentages, years and amounts outside sane yearly bounds are rejected.
"""

import re
from dataclasses import dataclass

YEAR, MONTH, WEEK, DAY, HOUR = "year", "month", "week", "day", "hour"
_MIN_YEARLY = 5_000
_PER_YEAR = {YEAR: 1, MONTH: 12, WEEK: 52, DAY: 260, HOUR: 2080}


@dataclass(frozen=True)
class Salary:
    min: float | None
    max: float | None
    currency: str | None
    period: str | None

    def display(self) -> str:
        """'USD 120,000 - 150,000 / year', 'EUR 60 / hour', 'USD 100,000+ / year', 'Up to …'."""
        if self.min is not None and self.max is not None and self.min != self.max:
            amount = f"{_fmt(self.min)} - {_fmt(self.max)}"
        elif self.min is not None and self.max is None:
            amount = f"{_fmt(self.min)}+"
        else:
            amount = _fmt(self.max if self.max is not None else self.min)
        text = f"{self.currency} {amount}" if self.currency else amount
        if self.min is None and self.max is not None:
            text = f"Up to {text}"
        return f"{text} / {self.period}" if self.period else text

    def yearly(self) -> tuple[float | None, float | None]:
        """(min, max) per year: hour x 2080, day x 260, week x 52, month x 12."""
        factor = _PER_YEAR.get(self.period or YEAR, 1)
        return (
            self.min * factor if self.min is not None else None,
            self.max * factor if self.max is not None else None,
        )


def _fmt(value: float | None) -> str:
    if value is None:
        return ""
    return f"{int(value):,}" if value == int(value) else f"{value:,.2f}"


_CODES = [
    "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "NZD", "HKD", "VND", "INR", "JPY", "CHF", "PLN",
    "BRL", "SEK", "NOK", "DKK", "CNY", "RMB", "KRW", "IDR", "MYR", "THB", "MXN", "ZAR", "AED",
    "CZK", "HUF", "PHP",
]  # fmt: skip
# Before an amount; PHP is left out ("PHP 8 developer"), ₱ still works.
_PREFIX_CODES = "|".join(c for c in _CODES if c != "PHP")
_SYMBOLS = r"US\$|AU\$|A\$|CA\$|C\$|S\$|NZ\$|R\$|HK\$|\$|€|£|¥|₹|₫|₩|₱|Rs\.?|RM|Rp|zł"
_POST = (
    "|".join(_CODES)
    + r"|VNĐ|(?i:dollars?|euros?|pounds?|đồng|vnđ|yen|rupees?|francs?)|€|£|₫|đ|zł|\$"
)
_MULT = r"(?i:million|mil|mn|thousand|triệu|trieu|tr|lakhs?|lacs?|lpa|crores?|cr|billion|bn|k|m)"
_SEP = r"[,. '’  ]"

_AMOUNT_RE = re.compile(
    r"(?<![\w.,+/:#])"
    rf"(?:(?P<code>{_PREFIX_CODES})\s?)?"
    rf"(?:(?P<sym>{_SYMBOLS})\s?)?"
    r"(?P<num>"
    r"(?P<indian>\d{1,2}(?:,\d{2})+,\d{3}(?!\d))"
    rf"|(?P<grp>\d{{1,3}}(?P<sep>{_SEP})\d{{3}}(?!\d)(?:(?P=sep)\d{{3}}(?!\d))*)"
    r"(?P<dec>[.,]\d{1,2}(?!\d))?"
    r"|(?P<plain>\d+(?:[.,]\d+)?)"
    r")"
    rf"(?:\s?(?P<mult>{_MULT})(?![^\W\d_]))?"
    rf"(?:\s?(?P<post>{_POST})(?![^\W\d_]))?"
)

_MULTIPLIERS = {
    "k": 1e3, "thousand": 1e3, "m": 1e6, "mil": 1e6, "mn": 1e6, "million": 1e6,
    "triệu": 1e6, "trieu": 1e6, "tr": 1e6, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5,
    "lpa": 1e5, "crore": 1e7, "crores": 1e7, "cr": 1e7, "billion": 1e9, "bn": 1e9,
}  # fmt: skip
_MULT_CURRENCY = {"triệu": "VND", "trieu": "VND", "tr": "VND", "lpa": "INR", "cr": "INR"} | {
    m: "INR" for m in ("lakh", "lakhs", "lac", "lacs", "crore", "crores")
}

_CURRENCY = {
    "$": "USD", "us$": "USD", "dollar": "USD", "dollars": "USD",
    "a$": "AUD", "au$": "AUD", "c$": "CAD", "ca$": "CAD", "s$": "SGD", "nz$": "NZD",
    "r$": "BRL", "hk$": "HKD", "€": "EUR", "euro": "EUR", "euros": "EUR",
    "£": "GBP", "pound": "GBP", "pounds": "GBP", "¥": "JPY", "yen": "JPY",
    "₹": "INR", "rs": "INR", "rs.": "INR", "rupee": "INR", "rupees": "INR",
    "₫": "VND", "đ": "VND", "đồng": "VND", "vnđ": "VND", "₩": "KRW", "₱": "PHP",
    "rm": "MYR", "rp": "IDR", "zł": "PLN", "rmb": "CNY", "franc": "CHF", "francs": "CHF",
}  # fmt: skip

# Rough units per USD, only to judge sizes (period guess, sanity bounds); 1 when missing.
_SCALE = {
    "VND": 25_000, "INR": 85, "JPY": 150, "KRW": 1_350, "IDR": 16_000, "PHP": 57, "THB": 35,
    "CNY": 7, "HKD": 7.8, "SEK": 10, "NOK": 10, "DKK": 7, "MXN": 18, "ZAR": 18, "CZK": 23,
    "HUF": 360, "BRL": 5, "PLN": 4, "AED": 3.7, "MYR": 4.5,
}  # fmt: skip
# Smallest amount read as (year, month, day) when the text names no period; below -> hour.
_THRESHOLDS = {
    "VND": (300_000_000, 1_000_000, 300_000),
    "INR": (200_000, 10_000, 3_000),
    "JPY": (1_500_000, 100_000, 10_000),
}
_LOW_VALUE = set(_THRESHOLDS)
_MIN_HOURLY = 7  # USD-ish: "$5" alone is not a wage
_MAX_YEARLY = 5_000_000
_MAX_RANGE_RATIO = 10

_BENEFIT_RE = re.compile(r"\b40[13]\s?\(?[kb]\)?(?!\w)", re.I)
_CLAUSE_BREAK_RE = re.compile(r"[.!?;](?=\s|$)|\n|•|\|")
_RANGE_GAP_RE = re.compile(r"^\s*(-|–|—|~|to|until|đến|tới|and)\s*$", re.I)
_BETWEEN_RE = re.compile(r"\bbetween\s*$", re.I)
_UP_TO_RE = re.compile(
    r"(?:\bup\s*to|\bmax(?:imum)?(?:\s+of)?|\bas\s+much\s+as|\blên\s+(?:đến|tới)|\btối\s+đa)"
    r"\s*:?\s*$",
    re.I,
)
_FROM_RE = re.compile(
    r"(?:\bfrom|\bstarting\s+(?:at|from)|\bstarts\s+at|\bmin(?:imum)?(?:\s+of)?|\bat\s+least|"
    r"\bover|\babove|\bmore\s+than|\bin\s+excess\s+of|\btừ|\btối\s+thiểu)\s*:?\s*$",
    re.I,
)
_TRAILING_JUNK_RE = re.compile(r"^(?:\s?%|[.,]?\d)")
_FUNDING_BEFORE_RE = re.compile(
    r"\b(?:raised|raising|raise|funding|funded|valuation|valued\s+at|revenue|arr|mrr|"
    r"stipends?|allowances?|budgets?|bonus(?:es)?|reimburs\w*|equipment|wellness|wellbeing|learning|education|training|referral|sign(?:ing|-on)|credits?|gift|per\s+diem|coworking|co-working|internet|home\s+office|setup|relocation|"
    r"investments?|invested|backed\s+by|secured|series\s+[a-h]\s+of|round\s+of)\b",
    re.I,
)
# After an amount, a plain "bonus" is usually "+ bonus" on top of a real salary ("£50k pa + bonus"),
# so only the before-side list treats it as a perk.
_FUNDING_AFTER_RE = re.compile(
    r"\b(?:funding|raised|series\s+[a-h]|seed|arr|mrr|revenue|valuation|users|customers|"
    r"stipends?|allowances?|budgets?|reimburs\w*|equipment|wellness|wellbeing|learning|education|training|referral|sign(?:ing|-on)|credits?|gift|per\s+diem|coworking|co-working|internet|home\s+office|setup|relocation|"
    r"clients|followers|subscribers|downloads|installs|members|employees|people|stars|"
    r"visitors|transactions|requests|records|investors?|investment|in\s+sales)\b",
    re.I,
)

_PERIOD_WORDS = (
    r"annually|annual|annum|yearly|years?|yrs?|monthly|months?|mths?|mo|weekly|weeks?|wks?|"
    r"daily|days?|hourly|hours?|hrs?|tháng|năm|tuần|ngày|giờ|p\.?\s?a\.?|p\.?\s?h\.?|y|m|w|d|h"
)
_PERIOD_AFTER_RE = re.compile(
    r"^\s*(?:(?:gross|net|base|salary|brutto|pre-tax)\s+){0,2}"
    r"(?:(?P<conn>/|per\b|an?\b|each\b|every\b|mỗi\b|một\b)\s*)?"
    rf"(?P<word>{_PERIOD_WORDS})(?![^\W\d_])",
    re.I,
)
_PERIOD_BEFORE_RE = re.compile(
    r"\b(annual(?:ly)?|yearly|per\s+(?:year|annum)|monthly|per\s+month|weekly|per\s+week|"
    r"daily|per\s+day|day\s+rate|hourly|per\s+hour)\b",
    re.I,
)
# Words that name a period on their own ("$90k annually"), vs nouns that need "/", "per", "a".
_ADJECTIVES = {
    "annually": YEAR, "annual": YEAR, "yearly": YEAR, "pa": YEAR, "monthly": MONTH,
    "weekly": WEEK, "daily": DAY, "hourly": HOUR, "ph": HOUR,
}  # fmt: skip
_NOUNS = {
    "annum": YEAR, "year": YEAR, "years": YEAR, "yr": YEAR, "yrs": YEAR, "năm": YEAR,
    "month": MONTH, "months": MONTH, "mth": MONTH, "mths": MONTH, "mo": MONTH, "tháng": MONTH,
    "week": WEEK, "weeks": WEEK, "wk": WEEK, "wks": WEEK, "tuần": WEEK,
    "day": DAY, "days": DAY, "ngày": DAY, "hour": HOUR, "hours": HOUR, "hr": HOUR, "hrs": HOUR,
    "giờ": HOUR,
}  # fmt: skip
_LETTERS = {"y": YEAR, "m": MONTH, "w": WEEK, "d": DAY, "h": HOUR}


def parse_salary(text: str | None) -> Salary | None:
    """The first plausible salary in `text`, or None."""
    if not text:
        return None
    text = _BENEFIT_RE.sub(lambda m: " " * len(m.group()), text)
    tokens = list(_AMOUNT_RE.finditer(text))
    for i, first in enumerate(tokens):
        if i + 1 < len(tokens):
            second = tokens[i + 1]
            gap = _RANGE_GAP_RE.match(text[first.end() : second.start()])
            if gap and (gap.group(1).lower() != "and" or _BETWEEN_RE.search(text[: first.start()])):
                salary = _candidate(text, first, second)
                if salary:
                    return salary
        salary = _candidate(text, first, None)
        if salary:
            return salary
    return None


def _candidate(text: str, first: re.Match[str], second: re.Match[str] | None) -> Salary | None:
    last = second or first
    if _TRAILING_JUNK_RE.match(text[last.end() :]):
        return None
    before, after = _clause_before(text, first.start()), _clause_after(text, last.end())
    if _FUNDING_BEFORE_RE.search(before[-30:]) or _FUNDING_AFTER_RE.search(after[:30]):
        return None

    low, low_mult = _value(first)
    high, high_mult = _value(second) if second else (low, low_mult)
    if second and not low_mult and high_mult and low <= high / _MULTIPLIERS[high_mult]:
        low *= _MULTIPLIERS[high_mult]  # "120-150k", "20-30 triệu"
        low_mult = high_mult
    mults = {low_mult, high_mult} - {None}
    currency = _currency([first] + ([second] if second else []), mults)

    plus = after.startswith("+")
    period, strong = _period_after(after.lstrip("+"))
    if period is None:
        found = _PERIOD_BEFORE_RE.findall(before)
        period, strong = (_period_word(found[-1]), True) if found else (None, False)
    if "lpa" in mults:
        period, strong = YEAR, True
    if currency is None:
        if not strong:
            period = None
        if period is None and not mults:
            return None
        if not mults and not second and low == int(low) and 1900 <= low <= 2100:
            return None  # a year

    if second:
        if low > high:
            low, high = high, low
        if low <= 0 or high / low > _MAX_RANGE_RATIO:
            return None
        lo, hi = low, high
    elif _UP_TO_RE.search(before):
        lo, hi = None, low
    elif plus or _FROM_RE.search(before):
        lo, hi = low, None
    else:
        lo, hi = low, low

    if period is None:
        period = _guess_period(hi if hi is not None else low, currency)
        if period is None or (currency is None and period != YEAR):
            return None
    salary = Salary(lo, hi, currency, period)
    return salary if _sane(salary) else None


def _value(m: re.Match[str]) -> tuple[float, str | None]:
    if m.group("indian"):
        number = float(m.group("indian").replace(",", ""))
    elif m.group("grp"):
        number = float(m.group("grp").replace(m.group("sep"), ""))
        if m.group("dec"):
            number += float("0." + m.group("dec")[1:])
    else:
        number = float(m.group("plain").replace(",", "."))
    mult = m.group("mult")
    if mult is None:
        return number, None
    mult = mult.lower()
    return number * _MULTIPLIERS[mult], mult


def _currency(matches: list[re.Match[str]], mults: set[str]) -> str | None:
    """An ISO code beats a specific symbol (A$, €) beats a bare '$'."""
    best, rank = None, 0
    for m in matches:
        for name, strength in (("code", 3), ("post", 3), ("sym", 2)):
            raw = m.group(name)
            if not raw:
                continue
            iso = _CURRENCY.get(raw.lower()) or (raw.upper() if raw.upper() in _CODES else None)
            if iso == "RMB":
                iso = "CNY"
            if raw in ("$", "dollar", "dollars") or (name == "post" and raw == "$"):
                strength = 1
            if iso and strength > rank:
                best, rank = iso, strength
    if best is None:
        for mult in mults:
            if mult in _MULT_CURRENCY:
                return _MULT_CURRENCY[mult]
    return best


def _period_after(after: str) -> tuple[str | None, bool]:
    m = _PERIOD_AFTER_RE.match(after)
    if not m:
        return None, False
    word = re.sub(r"[.\s]", "", m.group("word").lower())
    conn = m.group("conn")
    if word in _ADJECTIVES:
        return _ADJECTIVES[word], True
    if conn and word in _NOUNS:
        return _NOUNS[word], True
    if conn == "/" and word in _LETTERS:
        return _LETTERS[word], True
    if not conn and word in _NOUNS and not word.endswith("s"):
        return _NOUNS[word], False  # "$45 hour": fine with a currency, not on its own
    return None, False


def _period_word(phrase: str) -> str:
    phrase = phrase.lower()
    for key, period in (("year", YEAR), ("ann", YEAR), ("month", MONTH), ("week", WEEK)):
        if key in phrase:
            return period
    return DAY if ("day" in phrase or "daily" in phrase) else HOUR


def _guess_period(amount: float, currency: str | None) -> str | None:
    scale = _SCALE.get(currency or "", 1)
    year, month, day = _THRESHOLDS.get(currency or "", (15_000 * scale, 1_000 * scale, 300 * scale))
    if amount >= year:
        return YEAR
    if amount >= month:
        return MONTH
    if amount >= day:
        return DAY
    return HOUR if amount >= _MIN_HOURLY * scale else None


def _sane(salary: Salary) -> bool:
    scale = _SCALE.get(salary.currency or "", 1)
    # A real wage is at least a few thousand a year; smaller figures are perks (a $1,000
    # learning budget) or fees that slipped past the context checks.
    floor = 300 if salary.currency in _LOW_VALUE else _MIN_YEARLY
    values = [v / scale for v in salary.yearly() if v is not None]
    return bool(values) and all(floor <= v <= _MAX_YEARLY for v in values)


def _clause_before(text: str, start: int) -> str:
    window = text[max(0, start - 50) : start]
    breaks = list(_CLAUSE_BREAK_RE.finditer(window))
    return window[breaks[-1].end() :] if breaks else window


def _clause_after(text: str, end: int) -> str:
    window = text[end : end + 40]
    stop = _CLAUSE_BREAK_RE.search(window)
    return window[: stop.start()] if stop else window
