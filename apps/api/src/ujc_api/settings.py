"""App configuration (pydantic-settings). Variable names follow docs/product/ARCHITECTURE.md §10.

Values are read from the real process environment first. In development only, a repo-root
`.env.local` is also read (never committed, never logged, never read by anything other than
this settings loader). Production and test deployments set real environment variables instead,
so this file never needs to know a secret value to run.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/api/src/ujc_api/settings.py -> repo root is four levels up.
_REPO_ROOT = Path(__file__).resolve().parents[4]


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


@lru_cache
def get_settings() -> Settings:
    return Settings()
