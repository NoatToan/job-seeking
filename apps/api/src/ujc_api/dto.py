"""Row -> camelCase DTO mappers. `JOB_COLUMNS`/`CV_COLUMNS` fix the `SELECT` column order every
query must use so `job_dto`/`cv_dto` can map positionally (see job_crawler.db for the same
plain-SQL-no-ORM convention)."""

from datetime import datetime
from typing import Any

JOB_COLUMNS = (
    "id, source, url, apply_url, title, company, location, remote, employment_type,"
    " salary_text, tags, open_to, posted_at, first_seen_at"
)

CV_COLUMNS = "id, filename, status, error, keywords, profile, created_at, processed_at"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


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
    ) = row
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
        "salaryText": salary_text,
        "tags": list(tags or []),
        "openTo": list(open_to) if open_to is not None else None,
        "postedAt": _iso(posted_at),
        "firstSeenAt": _iso(first_seen_at),
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
