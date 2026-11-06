"""Columns the crawler derives from a job's text at upsert time, in one place.

`job_crawler.db` writes them on every upsert, and `recompute_derived` re-applies them to stored
jobs (backfill after a rule change: `python -m job_crawler --recompute-derived`).

- `open_to`         who may apply to a remote job (eligibility.py)
- `timezones`,
  `timezone_source` the zone(s) the job works in (timezones.py)
- `countries`       ISO codes of the countries the job is in / open to, for the country filter
- `tech_stack`      technologies the job asks for (techstack.py), for icons and the tech filter
"""

from typing import Any

from job_crawler import eligibility, techstack, timezones

DERIVED_COLUMNS = ("open_to", "timezones", "timezone_source", "countries", "tech_stack")

_ISO = set(eligibility.COUNTRIES.values())


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
) -> dict[str, Any]:
    extra = structured_locations(raw)
    zones, zone_source = timezones.job_timezones(location, description, extra, raw)
    return {
        "open_to": eligibility.open_to(location, remote, extra),
        "timezones": zones,
        "timezone_source": zone_source,
        "countries": job_countries(location, extra),
        "tech_stack": techstack.tech_stack(title, description, tags),
    }
