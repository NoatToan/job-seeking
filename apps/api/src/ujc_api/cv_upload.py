"""CV upload validation: size (≤5 MB) and type (magic bytes + extension, pdf/png/jpg/jpeg/webp/gif/
txt/md). Both must agree — a renamed `.exe` saved as `.pdf` still fails the magic-byte check."""

from collections.abc import Callable

MAX_CV_BYTES = 5 * 1024 * 1024

_EXT_MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "txt": "text/plain",
    "md": "text/markdown",
}

# No entry here (txt, md) means "no reliable magic bytes" — validated by decodability instead.
_MAGIC_CHECKS: dict[str, Callable[[bytes], bool]] = {
    "pdf": lambda b: b.startswith(b"%PDF-"),
    "png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "jpg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
    "gif": lambda b: b.startswith((b"GIF87a", b"GIF89a")),
}


class CvTooLarge(Exception):
    pass


class UnsupportedCvType(Exception):
    pass


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def validate_cv(filename: str, content: bytes) -> str:
    """Returns the mime type to store in `user_cvs.mime`.

    Raises `CvTooLarge` (-> 413) or `UnsupportedCvType` (-> 415).
    """
    if len(content) > MAX_CV_BYTES:
        raise CvTooLarge()
    ext = _extension(filename)
    if ext not in _EXT_MIME:
        raise UnsupportedCvType()
    magic_check = _MAGIC_CHECKS.get(ext)
    if magic_check is not None:
        if not magic_check(content):
            raise UnsupportedCvType()
    else:
        if b"\x00" in content:
            raise UnsupportedCvType()
        try:
            content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise UnsupportedCvType() from exc
    return _EXT_MIME[ext]
