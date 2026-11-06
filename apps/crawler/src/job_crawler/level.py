"""Seniority level of a job, for the level badge on job rows and the job detail.

`job_level(title, description, raw, tags)` returns `(level, source)`:

- `level`  one of `LEVELS` (low -> high), or None when nothing says it;
- `source` how sure we are, best first: "source" (the board's own seniority field, e.g. Himalayas
  `seniority`, LinkedIn "Seniority level"), "title" (a word in the title: "Senior", "Staff",
  "Intern", "Engineer III"…), "description" (a level phrase or "5+ years of experience" in the
  posting text).

Pure regex, no LLM. Rules are versioned with the description sections (`sections.VERSION`): bump
it after a rule change and the nightly backfill re-derives every row.
"""

import re
from collections.abc import Iterable
from typing import Any

LEVELS = ("intern", "junior", "mid", "senior", "lead", "manager", "director")

# --- source data -------------------------------------------------------------------------------

# Values boards use in their own seniority fields (lower-cased, spaces/dashes collapsed).
_SOURCE_VALUES: dict[str, str] = {
    "internship": "intern",
    "intern": "intern",
    "entry level": "junior",
    "entry": "junior",
    "junior": "junior",
    "associate": "junior",
    "mid level": "mid",
    "mid": "mid",
    "mid senior level": "senior",
    "senior": "senior",
    "lead": "lead",
    "staff": "lead",
    "principal": "lead",
    "manager": "manager",
    "director": "director",
    "executive": "director",
    "vp": "director",
    "c level": "director",
}

# Raw payload keys that carry a seniority value: Himalayas `seniority` (["Mid-level", "Senior"]),
# Arc `experienceLevel` ("senior") / `experienceLevels` (["staff"]), and the usual spellings for
# boards that add one later.
_SOURCE_KEYS = (
    "seniority",
    "seniorityLevel",
    "seniority_level",
    "experienceLevel",
    "experienceLevels",
)


def _norm(value: str) -> str:
    return re.sub(r"[\s_\-]+", " ", value.strip().lower())


def from_source(raw: dict[str, Any] | None) -> str | None:
    """The board's own seniority. Several values ("Mid-level", "Senior") -> the lowest, since the
    posting is open from there up."""
    if not raw:
        return None
    for key in _SOURCE_KEYS:
        value = raw.get(key)
        values: Iterable[Any] = value if isinstance(value, list) else [value]
        found = [_SOURCE_VALUES.get(_norm(v)) for v in values if isinstance(v, str) and v.strip()]
        found = [f for f in found if f]
        if found:
            return min(found, key=LEVELS.index)
    return None


# --- title -------------------------------------------------------------------------------------

_B = r"(?<![\w])"  # word start (works with accented letters, unlike \b on some inputs)
_E = r"(?![\w])"

# IC roles called "manager" that are not people managers: these fall through to the other rules.
_IC_MANAGER = (
    r"(?:product|project|program|programme|account|accounts|customer success|success|community|"
    r"partner|partnership|partnerships|relationship|territory|content|campaign|channel|category|"
    r"sales|key account|social media|office|case|release|brand|marketing|growth|lifecycle|"
    r"solutions?|implementation|onboarding|payroll|events?|property|store|shift|it)"
)

# Checked in this order: the first rule that matches the title wins.
_TITLE_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "intern",
        re.compile(
            _B + r"(?:intern|interns|internship|trainee|apprentice|apprenticeship|working student|"
            r"werkstudent(?:in)?|praktikant(?:in)?|praktikum|stagiaire|alternance|alternant|"
            r"becari[oa]|pr[aá]cticas|th[uự]c t[aậ]p(?: sinh)?)" + _E,
            re.I,
        ),
    ),
    (
        "director",
        re.compile(
            _B + r"(?:director|directeur|directora?|direktor(?:in)?|head of|head,|vp|svp|evp|"
            r"vice president|chief|cto|ceo|cfo|coo|cpo|cmo|ciso|cio|c-level|president|founder|"
            r"co-founder|gi[aá]m [dđ][oố]c|leiter(?:in)? des|gesch[aä]ftsf[uü]hrer(?:in)?)" + _E,
            re.I,
        ),
    ),
    (
        "manager",
        re.compile(
            _B + r"(?:manager|managers|mgr|teamleiter(?:in)?|leiter(?:in)?|responsable|jefe|jefa|"
            r"gerente|qu[aả]n l[yý]|tr[uư][oở]ng ph[oò]ng)" + _E,
            re.I,
        ),
    ),
    (
        "lead",
        re.compile(
            _B + r"(?:lead|leader|tech lead|team lead|staff|principal|distinguished|"
            r"chapter lead|tr[uư][oở]ng nh[oó]m)" + _E,
            re.I,
        ),
    ),
    (
        "senior",
        re.compile(
            _B + r"(?:senior|sr\.?|snr|s[eé]nior|expert|erfahren(?:e|er)?|confirm[eé]|experienced|"
            r"(?:engineer|developer|scientist|analyst|designer) (?:iii|3)|level (?:iii|3)|l5)" + _E,
            re.I,
        ),
    ),
    (
        "junior",
        re.compile(
            _B + r"(?:junior|jr\.?|entry[- ]level|graduate|new grad|associate|"
            r"d[eé]butant|einsteiger|(?:engineer|developer|scientist|analyst|designer) (?:i|1)|"
            r"level (?:i|1)|l3)" + _E,
            re.I,
        ),
    ),
    (
        "mid",
        re.compile(
            _B + r"(?:mid|mid-level|midlevel|intermediate|medior|"
            r"(?:engineer|developer|scientist|analyst|designer) (?:ii|2)|level (?:ii|2)|l4)" + _E,
            re.I,
        ),
    ),
]

_IC_MANAGER_RE = re.compile(_B + _IC_MANAGER + r"\s+manager" + _E, re.I)
_PEOPLE_MANAGER_RE = re.compile(
    r"^\s*(?:senior\s+|sr\.?\s+)?manager\b|"  # "Manager, Customer Success"
    + _B
    + r"(?:engineering|people|team|general|development|delivery|technical|qa|operations|"
    r"design|data|analytics|security|support|infrastructure|platform|software)\s+manager" + _E,
    re.I,
)
_REPORTS_TO = re.compile(
    _B
    + r"(?:assistant|reporting|reports?)\s+(?:to|for)\s+(?:the\s+|our\s+)?[\w&,-]+(?:\s+of\s+\w+)?",
    re.I,
)


def from_title(title: str | None) -> str | None:
    if not title:
        return None
    # "Executive Assistant to the CEO", "Report to the Head of Sales": who they work for, not
    # the job's own level.
    text = _REPORTS_TO.sub(" ", title.replace("/", " / "))
    for level, pattern in _TITLE_RULES:
        if not pattern.search(text):
            continue
        if (
            level == "manager"
            and _IC_MANAGER_RE.search(text)
            and not _PEOPLE_MANAGER_RE.search(text)
        ):
            # "Product Manager", "Account Manager": an IC role; a seniority word may still say
            # the level ("Senior Product Manager").
            continue
        if level == "lead" and re.search(_B + r"lead(?:s)?\s+(?:generation|gen)" + _E, text, re.I):
            continue
        return level
    # "Specialist I", "Engineer II", "Tier III", "Agent IV" (a typo'd "ll" too).
    numeral = _NUMERAL.search(text)
    if numeral:
        return _NUMERAL_LEVEL[numeral.group(1).upper().replace("LL", "II")]
    return None


_NUMERAL = re.compile(r"(?<=[A-Za-z] )(I|II|III|IV|V|ll)(?![\w'])")
_NUMERAL_LEVEL = {"I": "junior", "II": "mid", "III": "senior", "IV": "lead", "V": "lead"}


# --- description -------------------------------------------------------------------------------

_DESC_PHRASES: list[tuple[str, re.Pattern[str]]] = [
    (
        "intern",
        re.compile(
            _B
            + r"(?:this is an? (?:paid |unpaid |summer |\d+-month )?internship|internship program)"
            + _E,
            re.I,
        ),
    ),
    (
        "junior",
        re.compile(
            _B + r"(?:entry[- ]level (?:role|position|job)|junior (?:role|position)|"
            r"new grad(?:uate)?s? (?:are )?welcome|no (?:prior )?experience (?:required|needed))"
            + _E,
            re.I,
        ),
    ),
    (
        "senior",
        re.compile(_B + r"(?:senior[- ]level (?:role|position)|seniority: senior)" + _E, re.I),
    ),
]

# "5+ years of experience", "3-5 years' experience", "at least 4 years in", "minimum 2 years".
_YEARS = re.compile(
    r"(?:(?:at least|minimum(?: of)?|min\.?|over|more than)\s+)?"
    r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?"
    r"(?:years?|yrs?)['’]?\s*(?:\+\s*)?(?:of\s+)?"
    r"(?:[\w/-]+\s+){0,5}?(?:experience|exp\b|in\s+(?:a|an|the)\s|working|building|developing)",
    re.I,
)


def years_of_experience(text: str | None) -> int | None:
    """The smallest "N years of experience" the posting asks for (0-20), or None."""
    if not text:
        return None
    found = [int(m.group(1)) for m in _YEARS.finditer(text) if 0 <= int(m.group(1)) <= 20]
    return min(found) if found else None


def from_description(description: str | None) -> str | None:
    if not description:
        return None
    for level, pattern in _DESC_PHRASES:
        if pattern.search(description):
            return level
    years = years_of_experience(description)
    if years is None:
        return None
    if years <= 1:
        return "junior"
    if years <= 4:
        return "mid"
    return "senior"


def job_level(
    title: str | None,
    description: str | None,
    raw: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """`(level, source)`; `(None, None)` when nothing says it."""
    if level := from_source(raw):
        return level, "source"
    if level := from_title(title):
        return level, "title"
    if level := from_description(description):
        return level, "description"
    return None, None
