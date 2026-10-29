"""App configuration (pydantic-settings). Variable names follow docs/product/ARCHITECTURE.md §10.

Values are read from the real process environment first. In development only, a repo-root
`.env.local` is also read (never committed, never logged, never read by anything other than
this settings loader). Production and test deployments set real environment variables instead,
so this file never needs to know a secret value to run.
"""

import hashlib
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

# apps/api/src/ujc_api/settings.py -> repo root is four levels up.
_REPO_ROOT = Path(__file__).resolve().parents[4]

# A fixed, derived (not random) placeholder so `UJC_SECRET_KEY` has *some* value in development
# without anyone needing to set it. Never used outside `ujc_env="development"` (see the
# validator below) and deliberately not secret-looking so it is obvious in a warning log.
DEV_DEFAULT_SECRET_KEY = "dev-insecure-" + hashlib.sha256(b"ujc-dev-secret-key").hexdigest()


def _dotenv_path(repo_root: Path | None = None) -> Path | None:
    """The repo-root `.env.local` to load, or None.

    Only returned when `UJC_ENV` is unset or `development` (the default), and only when the file
    actually exists. `repo_root` is overridable so tests can exercise this without touching the
    real repo-root `.env.local`.
    """
    if os.environ.get("UJC_ENV", "development") != "development":
        return None
    candidate = (repo_root or _REPO_ROOT) / ".env.local"
    return candidate if candidate.is_file() else None


class Settings(BaseSettings):
    """Process-wide configuration. Field names match env var names (case-insensitive)."""

    model_config = SettingsConfigDict(
        env_file=_dotenv_path(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql://localhost:5432/ujc"
    ujc_env: Literal["development", "test", "production"] = "development"
    ujc_log_level: str = "INFO"

    # HMAC key for OTP code hashes and the CSRF token. Required outside development/test (see
    # `_check_secret_key` below); in development, a fixed derived constant is used instead so the
    # service runs with zero setup, with a logged warning.
    ujc_secret_key: str = DEV_DEFAULT_SECRET_KEY

    # Email OTP delivery (docs/product/FLOW_V2.md §2 "Email").
    ujc_otp_review_mode: bool = False
    # Comma-separated emails (case-insensitive) allowed to receive `devCode` when review mode is
    # on. Empty = review mode behaves as before (devCode for every email) — only for a trusted,
    # non-public deployment. Non-empty = the review build is public, so only these addresses ever
    # see a devCode; everyone else is sent a real email (or rejected if none is configured).
    ujc_otp_review_allowlist: str = ""
    resend_api_key: str | None = None
    ujc_mail_from: str = "Job Seeking <onboarding@resend.dev>"

    def otp_review_allowlist(self) -> frozenset[str]:
        return frozenset(
            e.strip().lower() for e in self.ujc_otp_review_allowlist.split(",") if e.strip()
        )

    @model_validator(mode="after")
    def _check_secret_key(self) -> "Settings":
        """`UJC_SECRET_KEY` signs OTP codes and CSRF tokens: outside development/test it must be
        set to a real value, never the development default (or empty)."""
        is_default = self.ujc_secret_key in ("", DEV_DEFAULT_SECRET_KEY)
        if self.ujc_env in ("development", "test"):
            if is_default:
                log.warning(
                    "UJC_SECRET_KEY is not set; using an insecure development default. "
                    "Set UJC_SECRET_KEY before deploying outside development/test."
                )
        elif is_default:
            raise ValueError(
                "UJC_SECRET_KEY must be set to a real secret when UJC_ENV is not "
                "'development' or 'test'"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
