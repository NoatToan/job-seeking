"""CV file -> text (pypdf, or Claude OCR for scans/images) -> structured profile (Claude)."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from job_crawler.matching.claude import run_claude
from job_crawler.matching.prompts import CV_PROFILE_SCHEMA, CV_SYSTEM, OCR_SCHEMA, OCR_SYSTEM

MAX_CV_CHARS = 30_000
MIN_TEXT_CHARS_PER_PAGE = 200
IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
TEXTS = {".txt", ".md"}


class UnsupportedFileError(ValueError):
    pass


@dataclass(slots=True)
class CvText:
    text: str
    ocr_used: bool


def pdf_text(path: Path) -> tuple[str, bool]:
    """(text, looks_scanned). Pages with almost no text layer count as scanned."""
    try:
        pages = [page.extract_text() or "" for page in PdfReader(path).pages]
    except PdfReadError:
        return "", True
    text = "\n\n".join(p.strip() for p in pages if p.strip())
    scanned = not pages or sum(len(p.strip()) for p in pages) < MIN_TEXT_CHARS_PER_PAGE * len(pages)
    return text, scanned


def ocr(path: Path) -> str:
    out = run_claude(
        f"Transcribe the file {path.name}.", system=OCR_SYSTEM, schema=OCR_SCHEMA, files=[path]
    )
    return str(out.get("text", "")).strip()


def extract_text(path: Path) -> CvText:
    suffix = path.suffix.lower()
    if suffix in TEXTS:
        return CvText(path.read_text(encoding="utf-8", errors="replace").strip(), False)
    if suffix == ".pdf":
        text, scanned = pdf_text(path)
        if not scanned:
            return CvText(text, False)
    elif suffix not in IMAGES:
        raise UnsupportedFileError("Supported: PDF, PNG, JPG, WEBP, GIF, TXT, MD")
    return CvText(ocr(path), True)


def extract_profile(text: str) -> dict[str, Any]:
    profile = run_claude(
        f"<cv>\n{text[:MAX_CV_CHARS]}\n</cv>", system=CV_SYSTEM, schema=CV_PROFILE_SCHEMA
    )
    profile["search_keywords"] = [
        k.strip().lower() for k in profile.get("search_keywords", []) if k.strip()
    ]
    return profile
