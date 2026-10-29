import pytest

from ujc_api.cv_upload import MAX_CV_BYTES, CvTooLarge, UnsupportedCvType, validate_cv

PDF_BYTES = b"%PDF-1.4\n%mock pdf content"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
JPG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 20
WEBP_BYTES = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"\x00" * 20
GIF_BYTES = b"GIF89a" + b"\x00" * 20


@pytest.mark.parametrize(
    "filename,content,mime",
    [
        ("cv.pdf", PDF_BYTES, "application/pdf"),
        ("cv.png", PNG_BYTES, "image/png"),
        ("cv.jpg", JPG_BYTES, "image/jpeg"),
        ("cv.jpeg", JPG_BYTES, "image/jpeg"),
        ("cv.webp", WEBP_BYTES, "image/webp"),
        ("cv.gif", GIF_BYTES, "image/gif"),
        ("cv.txt", b"Jane Doe\nSoftware Engineer", "text/plain"),
        ("cv.md", b"# Jane Doe\n\nSoftware Engineer", "text/markdown"),
    ],
)
def test_valid_cv_types_are_accepted(filename, content, mime):
    assert validate_cv(filename, content) == mime


def test_oversized_file_raises_cv_too_large():
    content = PDF_BYTES + b"0" * MAX_CV_BYTES
    with pytest.raises(CvTooLarge):
        validate_cv("cv.pdf", content)


def test_file_at_exactly_the_limit_is_accepted():
    content = b"%PDF-1.4\n" + b"0" * (MAX_CV_BYTES - 9)
    assert len(content) == MAX_CV_BYTES
    assert validate_cv("cv.pdf", content) == "application/pdf"


def test_unknown_extension_raises_unsupported_cv_type():
    with pytest.raises(UnsupportedCvType):
        validate_cv("cv.exe", b"MZ\x90\x00")


def test_no_extension_raises_unsupported_cv_type():
    with pytest.raises(UnsupportedCvType):
        validate_cv("cv", PDF_BYTES)


def test_mismatched_magic_bytes_raise_unsupported_cv_type():
    """A `.pdf` extension whose content isn't really a PDF (magic bytes must agree)."""
    with pytest.raises(UnsupportedCvType):
        validate_cv("cv.pdf", b"not a pdf at all")


def test_renamed_executable_as_png_is_rejected():
    with pytest.raises(UnsupportedCvType):
        validate_cv("cv.png", b"MZ\x90\x00\x03\x00\x00\x00")


def test_binary_content_with_txt_extension_is_rejected():
    with pytest.raises(UnsupportedCvType):
        validate_cv("cv.txt", b"\x00\x01\x02\xff\xfe")
