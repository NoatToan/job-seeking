"""Request models. Wire format is camelCase; unknown fields are rejected (`extra="forbid"`), so a
client can never set server-owned fields such as `status`, `authorId` or `reviewedBy` on create.
"""

from typing import Annotated
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.alias_generators import to_camel

from contributor_box.constants import (
    ADMIN_RESPONSE_MAX,
    BODY_MAX,
    ELEMENT_TEXT_MAX,
    NOTE_MAX,
    PAGE_TITLE_MAX,
    PAGE_URL_MAX,
    REGION_MAX,
    SCREENSHOT_MAX_DATA_URL_CHARS,
    SELECTOR_MAX,
    TITLE_MAX,
    TITLE_MIN,
    USER_AGENT_MAX,
    VIEWPORT_MAX,
    Kind,
    NoteVisibility,
    Status,
)

Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=TITLE_MIN, max_length=TITLE_MAX)
]


def _no_nul(value: str | None) -> str | None:
    # Postgres TEXT cannot store NUL; reject it as a 400 instead of failing the insert with a 500.
    if value is not None and "\x00" in value:
        raise ValueError("must not contain NUL characters")
    return value


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def normalize_page_url(value: str | None) -> str | None:
    """Absolute http(s) URL or a root-relative path, nothing else (no `javascript:`, `data:`,
    protocol-relative `//host` or credentials). Rendered as a link in the admin UI, so this is the
    server-side half of the stored-XSS defence (the UI re-checks before rendering a link)."""
    value = _blank_to_none(value)
    if value is None:
        return None
    if any(ch.isspace() or ord(ch) < 0x20 for ch in value):
        raise ValueError("must not contain whitespace or control characters")
    if "\\" in value:
        # Browsers treat `/\host` like `//host`; no legitimate page URL needs a backslash.
        raise ValueError("must not contain backslashes")
    if value.startswith("/") and not value.startswith("//"):
        return value
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("must be an http(s) URL or a path starting with /")
    if parts.username or parts.password:
        raise ValueError("must not contain credentials")
    return value


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Region(_Model):
    x: int = Field(ge=0, le=REGION_MAX)
    y: int = Field(ge=0, le=REGION_MAX)
    width: int = Field(ge=1, le=REGION_MAX)
    height: int = Field(ge=1, le=REGION_MAX)


class CreateItemRequest(_Model):
    kind: Kind
    title: Title
    body: str = Field(default="", max_length=BODY_MAX)
    page_url: str | None = Field(default=None, max_length=PAGE_URL_MAX)
    page_title: str | None = Field(default=None, max_length=PAGE_TITLE_MAX)
    element_selector: str | None = Field(default=None, max_length=SELECTOR_MAX)
    element_text: str | None = Field(default=None, max_length=ELEMENT_TEXT_MAX)
    region: Region | None = None
    viewport_width: int | None = Field(default=None, ge=1, le=VIEWPORT_MAX)
    viewport_height: int | None = Field(default=None, ge=1, le=VIEWPORT_MAX)
    # `data:image/jpeg;base64,...`; decoded and magic-byte-checked in `screenshot.py`.
    screenshot: str | None = Field(default=None, max_length=SCREENSHOT_MAX_DATA_URL_CHARS)
    screenshot_width: int | None = Field(default=None, ge=1, le=VIEWPORT_MAX)
    screenshot_height: int | None = Field(default=None, ge=1, le=VIEWPORT_MAX)

    @field_validator("title", "body", "page_title", "element_selector", "element_text")
    @classmethod
    def _text(cls, v: str | None) -> str | None:
        return _no_nul(v)

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str) -> str:
        return v.strip()

    @field_validator("page_title", "element_selector", "element_text")
    @classmethod
    def _optional_text(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("page_url")
    @classmethod
    def _page_url(cls, v: str | None) -> str | None:
        return normalize_page_url(_no_nul(v))


class AdminPatchRequest(_Model):
    """Admin edits. Only the fields sent are changed (`model_fields_set`); `adminResponse: null`
    clears the public reply."""

    kind: Kind | None = None
    title: Title | None = None
    body: str | None = Field(default=None, max_length=BODY_MAX)
    status: Status | None = None
    admin_response: str | None = Field(default=None, max_length=ADMIN_RESPONSE_MAX)

    @field_validator("title", "body", "admin_response")
    @classmethod
    def _text(cls, v: str | None) -> str | None:
        return _no_nul(v)

    @field_validator("body")
    @classmethod
    def _strip_body(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else None

    @field_validator("admin_response")
    @classmethod
    def _response(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("kind", "title", "body", "status")
    @classmethod
    def _not_null(cls, v: object) -> object:
        # Sent-as-null is not "clear" for these (they are NOT NULL columns): reject it.
        if v is None:
            raise ValueError("must not be null")
        return v


class NoteRequest(_Model):
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NOTE_MAX)
    ]
    visibility: NoteVisibility = "internal"

    @field_validator("body")
    @classmethod
    def _text(cls, v: str) -> str:
        _no_nul(v)
        return v


def clip_user_agent(value: str | None) -> str | None:
    if not value:
        return None
    return value.replace("\x00", "")[:USER_AGENT_MAX]
