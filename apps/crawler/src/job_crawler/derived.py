"""Columns the crawler derives from a job's text at upsert time, in one place.

`job_crawler.db` writes them on every upsert, and `recompute_derived` re-applies them to stored
jobs (backfill after a rule change: `python -m job_crawler --recompute-derived`).

- `open_to`         who may apply to a remote job (eligibility.py)
- `timezones`,
  `timezone_source` the zone(s) the job works in (timezones.py)
- `countries`       ISO codes of the countries the job is in / open to, for the country filter
- `tech_stack`      technologies the job asks for (techstack.py), for icons and the tech filter
- `salary_*`        structured salary (salary.py) from the source's salary text, else the posting
- `relocation_*`    relocation support offered / relocation required (relocation.py)

`PARSED_COLUMNS` (description sections and seniority level) are written on every upsert too, but
re-applied by a version-gated backfill instead (`sections.VERSION`, `db.backfill_sections`).
"""

from typing import Any

from psycopg.types.json import Jsonb

from job_crawler import eligibility, level, relocation, salary, sections, techstack, timezones

DERIVED_COLUMNS = (
    "open_to",
    "timezones",
    "timezone_source",
    "countries",
    "tech_stack",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "salary_source",
    "relocation_support",
    "relocation_required",
)

# Written by `parse_posting`; `sections_version` says which rules wrote the other three.
PARSED_COLUMNS = ("sections", "sections_version", "level", "level_source")

_ISO = set(eligibility.COUNTRIES.values()) | set(eligibility.EXTRA_COUNTRIES.values())


def structured_locations(raw: dict[str, Any] | None) -> list[str]:
    """Country lists some sources give as data, more reliable than the location text."""
    values = (raw or {}).get("locationRestrictions") or (raw or {}).get("requiredCountries") or []
    return [str(v) for v in values if v] if isinstance(values, list) else []


def job_countries(location: str | None, extra: list[str] | None = None) -> list[str] | None:
    """["DE", "FR"] for "Germany, France"; None for worldwide / unknown. Unlike `open_to` this
    also covers on-site jobs (it's where the job is, not who may apply)."""
    tokens = eligibility.open_to(location, True, extra) or []
    codes = sorted(t for t in tokens if t in _ISO)
    return codes or None


def derive(
    *,
    title: str | None,
    location: str | None,
    description: str | None,
    remote: bool,
    raw: dict[str, Any] | None,
    tags: list[str] | None = None,
    salary_text: str | None = None,
) -> dict[str, Any]:
    extra = structured_locations(raw)
    zones, zone_source = timezones.job_timezones(location, description, extra, raw)
    support, required = relocation.job_relocation(title, description)
    return {
        "open_to": eligibility.open_to(location, remote, extra),
        "timezones": zones,
        "timezone_source": zone_source,
        "countries": job_countries(location, extra),
        "tech_stack": techstack.tech_stack(title, description, tags),
        **job_salary(salary_text, title, description),
        "relocation_support": support,
        "relocation_required": required,
    }


_SALARY_COLUMNS = ("salary_min", "salary_max", "salary_currency", "salary_period", "salary_source")


def job_salary(
    salary_text: str | None, title: str | None, description: str | None
) -> dict[str, Any]:
    """The source's own salary string wins; otherwise look in the title, then the description."""
    found, source = salary.parse_salary(salary_text), "source"
    if found is None:
        found, source = (
            salary.parse_salary(title) or salary.parse_salary(description),
            "description",
        )
    if found is None:
        return dict.fromkeys(
            ("salary_min", "salary_max", "salary_currency", "salary_period", "salary_source")
        )
    return {
        "salary_min": found.min,
        "salary_max": found.max,
        "salary_currency": found.currency,
        "salary_period": found.period,
        "salary_source": source,
    }


def parse_posting(
    *, title: str | None, description: str | None, raw: dict[str, Any] | None
) -> dict[str, Any]:
    """`PARSED_COLUMNS` for one job: description sections (sections.py) and seniority level
    (level.py), stamped with the rules version. Sections are stored only when at least one
    heading was recognised; otherwise the app falls back to the plain description."""
    found = sections.parse_sections(description)
    if not sections.recognised(found):
        found = None
    job_level, level_source = level.job_level(title, description, raw)
    return {
        "sections": Jsonb(found) if found is not None else None,
        "sections_version": sections.VERSION,
        "level": job_level,
        "level_source": level_source,
    }
