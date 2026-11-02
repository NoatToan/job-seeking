"""Validates a companion runner's uploaded jobs (`POST /api/runner/jobs`,
docs/product/ARCHITECTURE.md D8): `site` must be one of the runner sites, each job's `source`
must match `site`, its URL host must be on that site's domain allowlist, and a call tops out at
`MAX_JOBS_PER_CALL`. A pure function (no FastAPI/DB), same shape as `cv_upload.validate_cv`, so
the rules are unit-testable without a database."""

from urllib.parse import urlparse

from job_crawler.models import JobRecord
from pydantic import ValidationError

#: Session sites the companion runner crawls (ARCHITECTURE D8/D11: no public API, browser-only).
RUNNER_SITES: dict[str, tuple[str, ...]] = {
    "linkedin": ("linkedin.com",),
    "glassdoor": ("glassdoor.com",),
    "arc": ("arc.dev",),
}

MAX_JOBS_PER_CALL = 200


class UnknownSite(Exception):
    pass


class TooManyJobs(Exception):
    pass


class InvalidJob(Exception):
    def __init__(self, index: int, reason: str) -> None:
        super().__init__(f"jobs[{index}]: {reason}")
        self.index = index
        self.reason = reason


def _host_allowed(site: str, url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(
        host == domain or host.endswith(f".{domain}") for domain in RUNNER_SITES.get(site, ())
    )


def validate_runner_jobs(site: str, jobs: list[dict]) -> list[JobRecord]:
    """Returns the validated `JobRecord`s (the runner's `raw` page data stripped), or raises
    `UnknownSite` / `TooManyJobs` / `InvalidJob`."""
    if site not in RUNNER_SITES:
        raise UnknownSite(site)
    if len(jobs) > MAX_JOBS_PER_CALL:
        raise TooManyJobs(len(jobs))

    records: list[JobRecord] = []
    for i, raw in enumerate(jobs):
        data = dict(raw)
        data.pop("raw", None)  # never trust or store the runner's page data server-side
        source = data.get("source")
        if source is not None and source != site:
            raise InvalidJob(i, f"source {source!r} does not match site {site!r}")
        data["source"] = site
        try:
            record = JobRecord.model_validate(data)
        except ValidationError as exc:
            raise InvalidJob(i, str(exc)) from exc
        if not _host_allowed(site, record.url):
            raise InvalidJob(i, f"url host not allowed for site {site!r}: {record.url!r}")
        records.append(record)
    return records
