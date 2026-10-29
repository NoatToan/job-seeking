import html
import re

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=20,
        follow_redirects=True,
    )


def strip_html(text: str | None, limit: int = 400) -> str:
    """Turn an HTML fragment into a short plain-text snippet."""
    if not text:
        return ""
    plain = re.sub(r"<[^>]+>", " ", html.unescape(text))
    plain = re.sub(r"\s+", " ", plain).strip()
    return plain if len(plain) <= limit else plain[:limit].rstrip() + "…"


def matches(keywords: str | None, *fields: str | None) -> bool:
    """True when every whitespace-separated keyword appears in one of the fields."""
    if not keywords:
        return True
    haystack = " ".join(f for f in fields if f).lower()
    return all(word in haystack for word in keywords.lower().split())
