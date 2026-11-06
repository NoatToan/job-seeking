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
    return normalize_description("\n".join(lines))


_INVISIBLE = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\u00ad]")
_ODD_SPACES = re.compile(r"[\xa0\u2000-\u200a\u202f\u205f\u3000]")
# A bullet marker alone on its line (`<li><p>text</p></li>` renders as "-" then the text).
_LONE_MARKER = re.compile(r"^(?:[-*•·▪●◦‣–—]|\d{1,2}[.)])$")
# Bullet glyphs at the start of a line, unified to "- ".
_GLYPH_BULLET = re.compile(r"^[•·▪●◦‣]\s*|^[*–—]\s+")
_BULLET_LINE = re.compile(r"^(?:- |\d{1,2}[.)] )")
_SENTENCE_END = (".", "!", "?", "…")


def _is_bullet(line: str) -> bool:
    return bool(_BULLET_LINE.match(line))


def _is_short(line: str) -> bool:
    """Heading-like: short and not a sentence ("Responsibilities", "Location: Remote")."""
    return len(line) <= 80 and not line.endswith(_SENTENCE_END) and not _is_bullet(line)


def normalize_description(text: str | None) -> str | None:
    """Tidy a job description's whitespace so it reads compactly (Slack request: "too much empty
    space in the JD"):

    - invisible characters dropped, odd spaces / tabs / runs of spaces -> one space, lines trimmed;
    - a lone bullet marker is joined to the text after it ("-\nBuild X" -> "- Build X"),
      "•", "▪", "*"… bullets become "- ", empty bullets are dropped;
    - at most one blank line in a row, none at the start or end;
    - no blank line between list items, after a line introducing a list ("We offer:"), after a
      heading before its paragraph, or between short "Key: value" lines.
    """
    if not text:
        return None
    text = _INVISIBLE.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))
    text = _ODD_SPACES.sub(" ", text)
    lines: list[str] = []
    marker: str | None = None
    for raw in text.split("\n"):
        line = re.sub(r"[ \t\f\v]+", " ", raw).strip()
        if marker is not None:
            if not line:
                continue
            if _LONE_MARKER.match(line):
                marker = line
                continue
            line = f"{marker} {line}" if marker[0].isdigit() else f"- {line}"
            marker = None
        elif _LONE_MARKER.match(line):
            marker = line
            continue
        line = _GLYPH_BULLET.sub("- ", line)
        if line in ("-", "- "):
            continue
        lines.append(line)

    out: list[str] = []
    for i, line in enumerate(lines):
        if line:
            out.append(line)
            continue
        if not out or not out[-1]:
            continue  # leading or repeated blank line
        nxt = next((n for n in lines[i + 1 :] if n), None)
        if nxt is None:
            continue  # trailing blank line
        prev = out[-1]
        if _is_bullet(nxt) and (_is_bullet(prev) or prev.endswith(":") or _is_short(prev)):
            continue
        if _is_short(prev) and not _is_short(nxt):
            continue  # heading -> its paragraph
        if _is_short(prev) and _is_short(nxt) and ": " in prev and ": " in nxt:
            continue  # "Location: Remote" / "Salary: …" block
        out.append("")
    return "\n".join(out).strip() or None


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
