"""Row -> camelCase DTO mappers. `JOB_COLUMNS`/`CV_COLUMNS` fix the `SELECT` column order every
query must use so `job_dto`/`cv_dto` can map positionally (see job_crawler.db for the same
plain-SQL-no-ORM convention)."""

from datetime import datetime
from typing import Any

from job_crawler.salary import Salary

JOB_COLUMNS = (
    "id, source, url, apply_url, title, company, location, remote, employment_type,"
    " salary_text, tags, open_to, posted_at, first_seen_at, timezones, timezone_source,"
    " tech_stack, salary_min, salary_max, salary_currency, salary_period, salary_source"
)

CV_COLUMNS = "id, filename, status, error, keywords, profile, created_at, processed_at"

# `GET /api/jobs/{id}`: the `Job` columns plus `description` (packages/core `JobDetail`).
JOB_DETAIL_COLUMNS = f"{JOB_COLUMNS}, description"

# `GET /api/sources`: one row per `source`, the latest `crawl_runs` row for it (or NULLs if it
# has none) and the total job count (see routers/jobs.py for the query).
SOURCE_COLUMNS = "source, status, started_at, finished_at, jobs_found, jobs_new, total"

APPLICATION_COLUMNS = (
    "id, job_id, job_snapshot, status, note, next_action_at, created_at, updated_at"
)

APPLICATION_EVENT_COLUMNS = "id, from_status, to_status, note, created_at"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def job_sort_key(row: tuple) -> tuple[datetime, int]:
    """Keyset position of a `JOB_COLUMNS` row: (coalesce(posted_at, first_seen_at), id)."""
    posted_at, first_seen_at = row[12], row[13]
    return (posted_at or first_seen_at), row[0]


def job_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `JOB_COLUMNS` to the `Job` shape (packages/core)."""
    (
        id_,
        source,
        url,
        apply_url,
        title,
        company,
        location,
        remote,
        employment_type,
        salary_text,
        tags,
        open_to,
        posted_at,
        first_seen_at,
        timezones,
        timezone_source,
        tech_stack,
        salary_min,
        salary_max,
        salary_currency,
        salary_period,
        salary_source,
    ) = row
    salary = (
        Salary(
            float(salary_min) if salary_min is not None else None,
            float(salary_max) if salary_max is not None else None,
            salary_currency,
            salary_period,
        )
        if salary_source
        else None
    )
    return {
        "id": str(id_),
        "source": source,
        "url": url,
        "applyUrl": apply_url,
        "title": title,
        "company": company,
        "location": location,
        "remote": bool(remote),
        "employmentType": employment_type,
        # The board's own text when it sent one, else the salary found in the posting.
        "salaryText": salary_text or (salary.display() if salary else None),
        "tags": list(tags or []),
        "openTo": list(open_to) if open_to is not None else None,
        "postedAt": _iso(posted_at),
        "firstSeenAt": _iso(first_seen_at),
        # Working time zone(s): IANA names or "UTC±hh:mm" (job_crawler.timezones); null = unknown.
        "timezones": list(timezones) if timezones is not None else None,
        "timezoneSource": timezone_source,
        # Tech ids found in the posting (job_crawler.techstack), e.g. ["nextjs", "react"].
        "techStack": list(tech_stack or []),
        # Structured salary (job_crawler.salary); `source` = "source" (the board) or "description".
        "salary": {
            "min": salary.min,
            "max": salary.max,
            "currency": salary.currency,
            "period": salary.period,
            "source": salary_source,
        }
        if salary
        else None,
    }


def job_detail_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `JOB_DETAIL_COLUMNS` to the `JobDetail` shape (packages/core):
    the `Job` fields plus `description`."""
    *job_row, description = row
    dto = job_dto(tuple(job_row))
    dto["description"] = description
    return dto


def source_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `SOURCE_COLUMNS` to the `SourceInfo` shape (packages/core)."""
    source, status, started_at, finished_at, jobs_found, jobs_new, total = row
    return {
        "source": source,
        "status": status,
        "startedAt": _iso(started_at),
        "finishedAt": _iso(finished_at),
        "jobsFound": int(jobs_found or 0),
        "jobsNew": int(jobs_new or 0),
        "total": int(total or 0),
    }


def cv_profile_dto(profile: dict | None) -> dict[str, Any] | None:
    if not profile:
        return None
    return {
        "headline": profile.get("headline") or "",
        "seniority": profile.get("seniority") or "",
        "skills": list(profile.get("skills") or []),
        "summary": profile.get("summary") or "",
    }


def cv_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `CV_COLUMNS` to the `Cv` shape (docs/product/FLOW_V2.md §4)."""
    id_, filename, status, error, keywords, profile, created_at, processed_at = row
    return {
        "id": str(id_),
        "filename": filename,
        "status": status,
        "error": error,
        "keywords": list(keywords or []),
        "profile": cv_profile_dto(profile),
        "createdAt": _iso(created_at),
        "processedAt": _iso(processed_at),
    }


def application_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `APPLICATION_COLUMNS` to the `Application` shape
    (packages/core). `job_snapshot` is stored as jsonb and comes back already decoded."""
    id_, job_id, job_snapshot, status, note, next_action_at, created_at, updated_at = row
    return {
        "id": str(id_),
        "jobId": str(job_id) if job_id is not None else None,
        "job": job_snapshot or None,
        "status": status,
        "note": note,
        "nextActionAt": _iso(next_action_at),
        "createdAt": _iso(created_at),
        "updatedAt": _iso(updated_at),
    }


def application_event_dto(row: tuple) -> dict[str, Any]:
    """Maps one row selected with `APPLICATION_EVENT_COLUMNS` to the `ApplicationEvent` shape."""
    id_, from_status, to_status, note, created_at = row
    return {
        "id": str(id_),
        "fromStatus": from_status,
        "toStatus": to_status,
        "note": note,
        "createdAt": _iso(created_at),
    }
