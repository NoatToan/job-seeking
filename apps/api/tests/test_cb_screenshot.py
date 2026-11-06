"""Screenshot decoding: magic bytes decide the type, size and format limits hold."""

import base64

import pytest

from contributor_box.constants import SCREENSHOT_MAX_BYTES
from contributor_box.screenshot import ScreenshotError, decode_screenshot, sniff_image_mime

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


def data_url(mime: str, data: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


@pytest.mark.parametrize(
    ("data", "mime"), [(JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")]
)
def test_accepts_allowed_formats(data: bytes, mime: str):
    shot = decode_screenshot(data_url(mime, data))
    assert shot.mime == mime
    assert shot.data == data


def test_type_comes_from_bytes_not_the_declared_mime():
    shot = decode_screenshot(data_url("image/png", JPEG))
    assert shot.mime == "image/jpeg"


def test_rejects_non_image_bytes_even_with_image_mime():
    with pytest.raises(ScreenshotError):
        decode_screenshot(data_url("image/png", b"<svg onload=alert(1)>"))


@pytest.mark.parametrize(
    "value",
    [
        "data:image/svg+xml;base64,PHN2Zz4=",
        "data:text/html;base64,PGgxPg==",
        "https://example.com/a.png",
        "data:image/png;base64,not base64!",
        "data:image/png,rawdata",
    ],
)
def test_rejects_other_urls_and_types(value: str):
    with pytest.raises(ScreenshotError):
        decode_screenshot(value)


def test_rejects_oversized_bytes():
    big = JPEG + b"\x00" * SCREENSHOT_MAX_BYTES
    with pytest.raises(ScreenshotError, match="too large"):
        decode_screenshot(data_url("image/jpeg", big))


def test_sniff_unknown_is_none():
    assert sniff_image_mime(b"GIF89a") is None
