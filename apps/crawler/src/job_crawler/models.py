from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class JobRecord(BaseModel):
    """One job posting, normalised to the columns of the `jobs` table."""

    source: str
    external_id: str
    url: str
    apply_url: str | None = None
    title: str
    company: str
    location: str | None = None
    remote: bool = False
    employment_type: str | None = None
    salary_text: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    posted_at: datetime | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class Board(BaseModel):
    """A company board on a public ATS API (row of `company_boards`)."""

    ats: str
    slug: str
    company_name: str


class SourceResult(BaseModel):
    """Jobs fetched from one source, plus per-board errors that did not stop the run."""

    jobs: list[JobRecord] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class SkipSource(Exception):
    """Raised when a source cannot run in this environment (e.g. missing credentials)."""
