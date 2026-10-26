"""Browser for the session crawler: stock Playwright Chromium with a persistent profile.

No stealth or fingerprint patching and no CAPTCHA bypass (CloakBrowser was tried in a POC and
then removed on purpose). When a site shows a bot check or login wall, the user handles it in
the window, or a headless run stops that site.
"""

import os
from pathlib import Path
from typing import Any

PROFILE_ROOT = Path(os.environ.get("UJC_BROWSER_PROFILES", Path.home() / ".unified-job-crawler"))
VIEWPORT = {"width": 1280, "height": 900}


class BrowserContext:
    """Persistent Playwright context whose close() also stops Playwright."""

    def __init__(self, user_dir: Path, headless: bool) -> None:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        try:
            self._ctx = self._pw.chromium.launch_persistent_context(
                str(user_dir), headless=headless, viewport=VIEWPORT
            )
        except Exception:
            self._pw.stop()
            raise

    def __getattr__(self, name: str) -> Any:
        return getattr(self._ctx, name)

    def close(self) -> None:
        try:
            self._ctx.close()
        finally:
            self._pw.stop()


def profile_dir(site_id: str) -> Path:
    path = PROFILE_ROOT / site_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def open_context(user_dir: Path, *, headless: bool = False) -> BrowserContext:
    """A persistent browser context; call .close() when done."""
    return BrowserContext(user_dir, headless)
