"""`GET/PATCH /api/me/profile`: the signed-in user's editable profile.

One screen edits two tables: `users` (display name, headline, links; migration 025) and
`user_preferences` (based-in country, time zone, keywords, remote only), so the "Edit profile"
form does not have to know which field lives where. `PATCH` is partial: only the keys present in
the body change, `null` clears an optional field, and a missing preferences row is created with
the same defaults `GET /api/me` reports.
"""

import re
import unicodedata
from typing import Annotated
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, BeforeValidator, ConfigDict, field_validator

from ujc_api.auth.csrf import require_csrf
from ujc_api.auth.deps import AuthedUser, current_user
from ujc_api.db import get_conn
from ujc_api.validation import MAX_KEYWORD_LEN, MAX_KEYWORDS

router = APIRouter(prefix="/api/me/profile", tags=["me"])

MAX_DISPLAY_NAME_LEN = 60
MAX_HEADLINE_LEN = 120
MAX_URL_LEN = 300
_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
# Hosts each link must point at (the "website" link may be any https host).
_LINK_HOSTS = {"linkedin": "linkedin.com", "github": "github.com"}


def _clean_text(value: object, max_len: int) -> str | None:
    """Trimmed single-line text with runs of whitespace collapsed; empty means "clear" (`None`).
    Rejects control and format characters (newlines, bidi overrides, zero-width joiners) so a name
    can't break the layout or spoof another one."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string")
    text = " ".join(value.split())
    if not text:
        return None
    if any(unicodedata.category(ch) in {"Cc", "Cf"} for ch in text):
        raise ValueError("must not contain control characters")
    if len(text) > max_len:
        raise ValueError(f"must be at most {max_len} characters")
    return text


def _clean_url(value: object, host: str | None) -> str | None:
    """An absolute `https://` URL (no credentials, no whitespace), optionally on `host` or one of
    its subdomains. Empty means "clear"."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string")
    url = value.strip()
    if not url:
        return None
    if len(url) > MAX_URL_LEN:
        raise ValueError(f"must be at most {MAX_URL_LEN} characters")
    if any(ch.isspace() for ch in url):
        raise ValueError("must not contain spaces")
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError as exc:
        raise ValueError("must be a valid URL") from exc
    if parts.scheme != "https" or not hostname or "." not in hostname:
        raise ValueError("must be an https:// URL")
    if parts.username is not None or parts.password is not None:
        raise ValueError("must not contain credentials")
    if host and hostname != host and not hostname.endswith("." + host):
        raise ValueError(f"must be a {host} URL")
    return url


DisplayName = Annotated[str | None, BeforeValidator(lambda v: _clean_text(v, MAX_DISPLAY_NAME_LEN))]
Headline = Annotated[str | None, BeforeValidator(lambda v: _clean_text(v, MAX_HEADLINE_LEN))]


class ProfileLinks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    linkedin: Annotated[
        str | None, BeforeValidator(lambda v: _clean_url(v, _LINK_HOSTS["linkedin"]))
    ] = None
    github: Annotated[
        str | None, BeforeValidator(lambda v: _clean_url(v, _LINK_HOSTS["github"]))
    ] = None
    website: Annotated[str | None, BeforeValidator(lambda v: _clean_url(v, None))] = None


class ProfilePatch(BaseModel):
    """Every key optional; only the keys sent are written (`model_fields_set`)."""

    model_config = ConfigDict(extra="forbid")

    displayName: DisplayName = None  # noqa: N815 - camelCase matches the wire contract
    headline: Headline = None
    # Partial too: `{"links": {"github": null}}` clears only GitHub.
    links: ProfileLinks | None = None
    candidateCountry: str | None = None  # noqa: N815 - camelCase matches the wire contract
    timeZone: str | None = None  # noqa: N815 - camelCase matches the wire contract
    keywords: list[str] | None = None
    remoteOnly: bool | None = None  # noqa: N815 - camelCase matches the wire contract

    @field_validator("candidateCountry", mode="before")
    @classmethod
    def _country(cls, v: object) -> str | None:
        if v is None or v == "":
            return None
        if not isinstance(v, str) or not _COUNTRY_RE.match(v.strip().upper()):
            raise ValueError("candidateCountry must be a two-letter ISO country code")
        return v.strip().upper()

    @field_validator("timeZone")
    @classmethod
    def _time_zone(cls, v: str | None) -> str | None:
        if v is None:
            raise ValueError("timeZone cannot be cleared")
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timeZone must be a valid IANA time zone name") from exc
        return v

    @field_validator("keywords")
    @classmethod
    def _keywords(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            raise ValueError("keywords cannot be null (send [] to clear)")
        if len(v) > MAX_KEYWORDS:
            raise ValueError(f"at most {MAX_KEYWORDS} keywords")
        cleaned: list[str] = []
        for k in v:
            k = k.strip()
            if not k or len(k) > MAX_KEYWORD_LEN:
                raise ValueError(f"each keyword must be 1-{MAX_KEYWORD_LEN} characters")
            if k.lower() not in (c.lower() for c in cleaned):
                cleaned.append(k)
        return cleaned

    @field_validator("remoteOnly")
    @classmethod
    def _remote_only(cls, v: bool | None) -> bool | None:
        if v is None:
            raise ValueError("remoteOnly cannot be null")
        return v


def read_profile(conn: psycopg.Connection, user_id: int) -> dict:
    row = conn.execute(
        "SELECT u.display_name, u.headline, u.linkedin_url, u.github_url, u.website_url,"
        " p.candidate_country, p.digest_tz, p.keywords, p.remote_only"
        " FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id WHERE u.id = %s",
        (user_id,),
    ).fetchone()
    if row is None:  # pragma: no cover - the session lookup already proved the user exists
        row = (None,) * 9
    (name, headline, linkedin, github, website, country, tz, keywords, remote_only) = row
    return {
        "displayName": name,
        "headline": headline,
        "links": {"linkedin": linkedin, "github": github, "website": website},
        "candidateCountry": country,
        # Same default as `GET /api/me` (`_DEFAULT_DIGEST_TZ`) for a user with no preferences row.
        "timeZone": tz or "Asia/Ho_Chi_Minh",
        "keywords": list(keywords or []),
        "remoteOnly": bool(remote_only),
    }


@router.get("")
def get_profile(
    user: AuthedUser = Depends(current_user), conn: psycopg.Connection = Depends(get_conn)
) -> dict:
    return {"profile": read_profile(conn, user.id)}


# Wire key -> column, per table. Only these names ever reach the SQL text.
_USER_COLUMNS = {"displayName": "display_name", "headline": "headline"}
_LINK_COLUMNS = {"linkedin": "linkedin_url", "github": "github_url", "website": "website_url"}
_PREF_COLUMNS = {
    "candidateCountry": "candidate_country",
    "timeZone": "digest_tz",
    "keywords": "keywords",
    "remoteOnly": "remote_only",
}


@router.patch("", dependencies=[Depends(require_csrf)])
def patch_profile(
    body: ProfilePatch,
    user: AuthedUser = Depends(current_user),
    conn: psycopg.Connection = Depends(get_conn),
) -> dict:
    sent = body.model_fields_set
    user_sets: dict[str, object] = {
        column: getattr(body, key) for key, column in _USER_COLUMNS.items() if key in sent
    }
    if "links" in sent and body.links is not None:
        for key, column in _LINK_COLUMNS.items():
            if key in body.links.model_fields_set:
                user_sets[column] = getattr(body.links, key)
    pref_sets: dict[str, object] = {
        column: getattr(body, key) for key, column in _PREF_COLUMNS.items() if key in sent
    }

    with conn.transaction():
        if user_sets:
            assignments = ", ".join(f"{column} = %s" for column in user_sets)
            conn.execute(
                f"UPDATE users SET {assignments} WHERE id = %s",  # noqa: S608 - fixed column names
                (*user_sets.values(), user.id),
            )
        if pref_sets:
            # Column defaults (migration 007/014) fill whatever this PATCH doesn't send.
            conn.execute(
                "INSERT INTO user_preferences (user_id) VALUES (%s)"
                " ON CONFLICT (user_id) DO NOTHING",
                (user.id,),
            )
            assignments = ", ".join(f"{column} = %s" for column in pref_sets)
            conn.execute(
                f"UPDATE user_preferences SET {assignments}, updated_at = now()"  # noqa: S608
                " WHERE user_id = %s",
                (*pref_sets.values(), user.id),
            )
    return {"profile": read_profile(conn, user.id)}
