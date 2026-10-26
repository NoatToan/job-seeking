"""Browser engines for the session crawler.

- `cloak` (default): CloakBrowser, a Chromium build with source-level fingerprint patches, so
  anti-bot checks (Cloudflare etc.) see a normal browser and usually don't show a challenge.
  It does not solve CAPTCHAs: if one still appears, the user solves it in the window.
- `chromium`: stock Playwright Chromium, kept for comparison (`poc` command) and as a fallback.

Each engine/site pair gets its own persistent profile dir, because a login made under one
fingerprint looks like a different device under another.
"""

import os
from pathlib import Path
from typing import Any

ENGINES = ("cloak", "chromium")
PROFILE_ROOT = Path(os.environ.get("UJC_BROWSER_PROFILES", Path.home() / ".unified-job-crawler"))
VIEWPORT = {"width": 1280, "height": 900}


class _ChromiumContext:
    """Stock Playwright persistent context whose close() also stops Playwright (like cloak's)."""

    def __init__(self, user_dir: Path, headless: bool) -> None:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self._ctx = self._pw.chromium.launch_persistent_context(
            str(user_dir), headless=headless, viewport=VIEWPORT
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._ctx, name)

    def close(self) -> None:
        try:
            self._ctx.close()
        finally:
            self._pw.stop()


def profile_dir(engine: str, site_id: str) -> Path:
    path = PROFILE_ROOT / engine / site_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def open_context(engine: str, user_dir: Path, *, headless: bool = False) -> Any:
    """A persistent browser context; call .close() when done."""
    if engine == "cloak":
        try:
            from cloakbrowser import launch_persistent_context
        except ImportError as exc:  # pragma: no cover - optional extra
            raise RuntimeError(
                "cloakbrowser is not installed: run `uv sync --extra browser`"
            ) from exc
        # humanize: human-like mouse/scroll timing. No proxy: it runs from the user's own network.
        return launch_persistent_context(
            str(user_dir), headless=headless, humanize=True, viewport=VIEWPORT
        )
    if engine == "chromium":
        return _ChromiumContext(user_dir, headless)
    raise ValueError(f"unknown engine {engine!r} (choose from {', '.join(ENGINES)})")
