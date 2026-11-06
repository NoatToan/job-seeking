"""Feed HTML -> a small, safe block document for republished (full-text) articles.

We never store or render third-party HTML. The body is converted to JSON blocks that the web app
renders with plain React elements (text is escaped, no dangerouslySetInnerHTML):

    {"type": "p" | "quote", "inline": [Span, ...]}
    {"type": "h", "level": 2 | 3 | 4, "inline": [Span, ...]}
    {"type": "ul" | "ol", "items": [[Span, ...], ...]}
    {"type": "pre", "text": str}
    {"type": "hr"}

    Span = {"text": str, "bold"?: true, "italic"?: true, "code"?: true, "href"?: str}

Everything else is dropped: scripts, styles, iframes, embeds, forms, images and their captions
(image rights are usually separate from the text licence), and every attribute except a link's
http(s) href. The wording is kept verbatim, as CC BY-ND requires.
"""

import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

MAX_BLOCKS = 400
MAX_CHARS = 120_000
MAX_HREF = 2000

_SKIP = {
    "script", "style", "iframe", "object", "embed", "svg", "math", "video", "audio", "picture",
    "source", "noscript", "form", "button", "select", "textarea", "input", "canvas", "figcaption",
    "template", "head", "title",
}  # fmt: skip
_HEADINGS = {"h1": 2, "h2": 2, "h3": 3, "h4": 4, "h5": 4, "h6": 4}
_PARAGRAPH_BREAK = {"p", "div", "section", "article", "figure", "header", "footer", "aside", "tr",
                    "table", "dl", "dt", "dd", "center", "main"}  # fmt: skip
_MARKS = {"strong": "bold", "b": "bold", "em": "italic", "i": "italic", "code": "code"}
_WS = re.compile(r"\s+")


def safe_href(href: str | None, base: str) -> str | None:
    """Absolute http(s) URL or None (javascript:, data:, mailto:, credentials... are dropped)."""
    if not href:
        return None
    url = urljoin(base, href.strip())
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username:
        return None
    return url if len(url) <= MAX_HREF else None


class _BodyParser(HTMLParser):
    def __init__(self, base_url: str, pixel: re.Pattern[str] | None) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.pixel_re = pixel
        self.pixel_url: str | None = None
        self.blocks: list[dict[str, Any]] = []
        self.skip = 0
        self.marks: dict[str, int] = {"bold": 0, "italic": 0, "code": 0}
        self.links: list[str | None] = []
        self.spans: list[dict[str, Any]] = []
        self.kind: tuple[str, int] = ("p", 0)  # current block type for the pending spans
        self.lists: list[dict[str, Any]] = []  # open ul/ol blocks
        self.quote = 0
        self.pre: list[str] | None = None

    # -- helpers -------------------------------------------------------------------------------
    def _flush(self) -> None:
        spans = _tidy(self.spans)
        self.spans = []
        if not spans:
            self.kind = ("p", 0)
            return
        if self.lists and self.kind[0] == "li":
            self.lists[-1]["items"].append(spans)
        elif self.kind[0] == "h":
            self.blocks.append({"type": "h", "level": self.kind[1], "inline": spans})
        else:
            self.blocks.append({"type": "quote" if self.quote else "p", "inline": spans})
        self.kind = ("p", 0)

    # -- HTMLParser callbacks ------------------------------------------------------------------
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "img" and self.pixel_re is not None and self.pixel_url is None:
            src = dict(attrs).get("src") or ""
            if self.pixel_re.match(src):
                self.pixel_url = src
            return
        if tag in _SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if self.pre is not None:
            return
        if tag == "pre":
            self._flush()
            self.pre = []
        elif tag in _HEADINGS:
            self._flush()
            self.kind = ("h", _HEADINGS[tag])
        elif tag in ("ul", "ol"):
            self._flush()
            block = {"type": tag, "items": []}
            self.lists.append(block)
        elif tag == "li":
            self._flush()
            self.kind = ("li", 0)
        elif tag == "blockquote":
            self._flush()
            self.quote += 1
        elif tag in _PARAGRAPH_BREAK:
            if self.kind[0] != "li":
                self._flush()
        elif tag == "br":
            self.spans.append({"text": "\n"})
        elif tag == "hr":
            self._flush()
            self.blocks.append({"type": "hr"})
        elif tag in _MARKS:
            self.marks[_MARKS[tag]] += 1
        elif tag == "a":
            self.links.append(safe_href(dict(attrs).get("href"), self.base_url))
        elif tag in ("td", "th"):
            self.spans.append({"text": " "})

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == "pre" and self.pre is not None:
            text = "".join(self.pre).strip("\n")
            if text.strip():
                self.blocks.append({"type": "pre", "text": text})
            self.pre = None
        elif self.pre is not None:
            return
        elif tag in _HEADINGS or tag == "li":
            self._flush()
        elif tag in ("ul", "ol") and self.lists:
            self._flush()
            block = self.lists.pop()
            if block["items"]:
                if self.lists:  # nested list: fold its items into the parent list
                    self.lists[-1]["items"].extend(block["items"])
                else:
                    self.blocks.append(block)
        elif tag == "blockquote":
            self._flush()
            self.quote = max(0, self.quote - 1)
        elif tag in _PARAGRAPH_BREAK:
            if self.kind[0] != "li":
                self._flush()
        elif tag in _MARKS:
            key = _MARKS[tag]
            self.marks[key] = max(0, self.marks[key] - 1)
        elif tag == "a" and self.links:
            self.links.pop()

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.pre is not None:
            self.pre.append(data)
            return
        span: dict[str, Any] = {"text": data}
        for key, depth in self.marks.items():
            if depth:
                span[key] = True
        href = next((h for h in reversed(self.links) if h), None) if self.links else None
        if href:
            span["href"] = href
        self.spans.append(span)

    def close(self) -> None:
        super().close()
        self._flush()
        while self.lists:
            block = self.lists.pop()
            if block["items"]:
                self.blocks.append(block)


def _tidy(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse whitespace, merge neighbours with the same marks, trim the ends."""
    out: list[dict[str, Any]] = []
    for span in spans:
        text = span["text"]
        if text != "\n":
            text = _WS.sub(" ", text)
        if not text:
            continue
        span = {**span, "text": text}
        prev = out[-1] if out else None
        same_marks = prev is not None and {k: v for k, v in prev.items() if k != "text"} == {
            k: v for k, v in span.items() if k != "text"
        }
        # Line breaks stay their own span ({"text": "\n"}) so the web renders them as <br>.
        if same_marks and prev and "\n" not in (text, prev["text"]):
            out[-1] = {**prev, "text": _WS.sub(" ", prev["text"] + text)}
        else:
            out.append(span)
    while out and not out[0]["text"].strip():
        out.pop(0)
    while out and not out[-1]["text"].strip():
        out.pop()
    if out:
        out[0] = {**out[0], "text": out[0]["text"].lstrip()}
        out[-1] = {**out[-1], "text": out[-1]["text"].rstrip()}
    return out


def html_to_blocks(
    html: str | None, base_url: str, *, pixel_pattern: str | None = None
) -> tuple[list[dict[str, Any]], str | None]:
    """Convert feed HTML to blocks. Returns (blocks, required tracking-pixel URL or None).
    Raises ValueError when the result is empty or exceeds the size limits."""
    parser = _BodyParser(base_url, re.compile(pixel_pattern) if pixel_pattern else None)
    parser.feed(html or "")
    parser.close()
    blocks = parser.blocks
    if not blocks:
        raise ValueError("empty body")
    if len(blocks) > MAX_BLOCKS or body_chars(blocks) > MAX_CHARS:
        raise ValueError("body too large")
    return blocks, parser.pixel_url


def body_chars(blocks: list[dict[str, Any]]) -> int:
    total = 0
    for block in blocks:
        if block["type"] == "pre":
            total += len(block["text"])
        for span in block.get("inline", []):
            total += len(span["text"])
        for item in block.get("items", []):
            total += sum(len(s["text"]) for s in item)
    return total


def body_text(blocks: list[dict[str, Any]]) -> str:
    """Plain text of a block document (for excerpts and keyword topics)."""
    parts: list[str] = []
    for block in blocks:
        if block["type"] == "pre":
            parts.append(block["text"])
        elif "inline" in block:
            parts.append("".join(s["text"] for s in block["inline"]))
        elif "items" in block:
            parts.extend("".join(s["text"] for s in item) for item in block["items"])
    return "\n".join(parts)
