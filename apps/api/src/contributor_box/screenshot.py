"""Decodes and validates the screenshot the widget sends as a `data:` URL.

The declared MIME type is never trusted: the bytes must start with the magic number of an allowed
image format and the stored/served type is the one the bytes prove, not the one the client claims.
"""

import base64
import binascii
import re
from dataclasses import dataclass

from contributor_box.constants import SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_DATA_URL_CHARS

_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$")


class ScreenshotError(ValueError):
    """Raised with a short, user-safe message."""


@dataclass(frozen=True, slots=True)
class Screenshot:
    mime: str
    data: bytes


def sniff_image_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def decode_screenshot(data_url: str) -> Screenshot:
    if len(data_url) > SCREENSHOT_MAX_DATA_URL_CHARS:
        raise ScreenshotError("screenshot is too large")
    match = _DATA_URL.match(data_url)
    if match is None:
        raise ScreenshotError("screenshot must be a base64 JPEG, PNG or WebP data URL")
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ScreenshotError("screenshot is not valid base64") from exc
    if not data:
        raise ScreenshotError("screenshot is empty")
    if len(data) > SCREENSHOT_MAX_BYTES:
        raise ScreenshotError("screenshot is too large")
    mime = sniff_image_mime(data)
    if mime is None:
        raise ScreenshotError("screenshot is not a JPEG, PNG or WebP image")
    return Screenshot(mime=mime, data=data)
