"""Async Playwright helper for future HTML sources (not used by the current API/RSS sources).

Requires the optional extra: `uv sync --extra browser && uv run playwright install chromium`.
It only loads public pages: it never logs in, and every call uses a fresh browser context
with no stored cookies or session state.
"""

from job_crawler import USER_AGENT


async def fetch_html(url: str, *, timeout_ms: int = 30_000, wait_until: str = "networkidle") -> str:
    """Launch headless Chromium, load `url` in a clean context and return the page HTML."""
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "playwright is not installed; run `uv sync --extra browser` "
            "and `uv run playwright install chromium`"
        ) from exc

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            context = await browser.new_context(user_agent=USER_AGENT)
            page = await context.new_page()
            await page.goto(url, timeout=timeout_ms, wait_until=wait_until)
            html = await page.content()
            await context.close()
            return html
        finally:
            await browser.close()
