import html
import re
from datetime import UTC, datetime
from html.parser import HTMLParser

_BLOCK_TAGS = {
    "br",
    "p",
    "div",
    "li",
    "ul",
    "ol",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "table",
    "section",
    "article",
    "blockquote",
    "pre",
    "hr",
}
_SKIP_TAGS = {"script", "style"}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(value: str | None, *, escaped: bool = False) -> str | None:
    """Strip HTML tags to plain text. `escaped=True` unescapes HTML-escaped HTML first."""
    if not value:
        return None
    if escaped:
        value = html.unescape(value)
    parser = _TextExtractor()
    parser.feed(value)
    parser.close()
    text = "".join(parser.parts).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def clean(value: object) -> str | None:
    """Return a stripped string, or None for empty / missing values."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_datetime(value: object) -> datetime | None:
    """Parse ISO-8601 strings or epoch seconds/milliseconds into an aware datetime."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, int | float) or (isinstance(value, str) and value.isdigit()):
            ts = float(value)
            if ts > 1e11:  # milliseconds
                ts /= 1000
            return datetime.fromtimestamp(ts, tz=UTC)
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def format_salary(
    min_value: object, max_value: object, currency: object = None, period: object = None
) -> str | None:
    """Build a short salary string like 'USD 100,000 - 150,000 / annual'."""

    def fmt(v: object) -> str | None:
        if v in (None, "", 0):
            return None
        try:
            return f"{float(v):,.0f}"
        except (TypeError, ValueError):
            return str(v)

    lo, hi = fmt(min_value), fmt(max_value)
    if not lo and not hi:
        return None
    amount = f"{lo} - {hi}" if lo and hi and lo != hi else (lo or hi)
    text = f"{currency} {amount}" if currency else amount
    return f"{text} / {period}" if period else text
