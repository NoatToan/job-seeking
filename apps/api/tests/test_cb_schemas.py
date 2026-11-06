"""Request validation: lengths, URL schemes, forbidden fields, NUL bytes."""

import pytest
from pydantic import ValidationError

from contributor_box.schemas import (
    AdminPatchRequest,
    CreateItemRequest,
    NoteRequest,
    clip_user_agent,
    normalize_page_url,
)


def create(**overrides):
    return CreateItemRequest.model_validate({"kind": "idea", "title": "Dark mode", **overrides})


def test_minimal_create_is_valid_and_trims():
    req = create(title="  Dark mode  ", body="  please  ")
    assert req.title == "Dark mode"
    assert req.body == "please"
    assert req.page_url is None


@pytest.mark.parametrize("title", ["", "ab", "x" * 141, "   "])
def test_title_length(title: str):
    with pytest.raises(ValidationError):
        create(title=title)


def test_unknown_kind_rejected():
    with pytest.raises(ValidationError):
        create(kind="praise")


@pytest.mark.parametrize("field", ["status", "authorId", "adminResponse", "reviewedBy"])
def test_server_owned_fields_cannot_be_set_on_create(field: str):
    with pytest.raises(ValidationError):
        create(**{field: "approved"})


def test_nul_bytes_rejected():
    with pytest.raises(ValidationError):
        create(body="a\x00b")


def test_body_limit():
    create(body="x" * 5000)
    with pytest.raises(ValidationError):
        create(body="x" * 5001)


@pytest.mark.parametrize(
    "url",
    [
        "https://jobs.example.com/search?q=react",
        "http://localhost:3000/tracker/",
        "/jobs/view/?id=5",
    ],
)
def test_page_url_accepts_http_and_paths(url: str):
    assert normalize_page_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//evil.example.com/x",
        "/\\evil.example.com/x",
        "https://user:pass@example.com/",
        "https://example.com/a b",
        "ftp://example.com/",
        "vbscript:msgbox",
        "https:/no-host",
    ],
)
def test_page_url_rejects_unsafe(url: str):
    with pytest.raises(ValueError):
        normalize_page_url(url)


def test_region_bounds():
    req = create(region={"x": 0, "y": 10, "width": 100, "height": 20})
    assert req.region is not None and req.region.width == 100
    with pytest.raises(ValidationError):
        create(region={"x": -1, "y": 0, "width": 1, "height": 1})
    with pytest.raises(ValidationError):
        create(region={"x": 0, "y": 0, "width": 0, "height": 1})
    with pytest.raises(ValidationError):
        create(region={"x": 0, "y": 0, "width": 1, "height": 1, "script": "x"})


def test_patch_tracks_sent_fields_and_rejects_null_for_required_columns():
    assert AdminPatchRequest.model_validate({"status": "approved"}).model_fields_set == {"status"}
    cleared = AdminPatchRequest.model_validate({"adminResponse": None})
    assert cleared.model_fields_set == {"admin_response"}
    assert cleared.admin_response is None
    for field in ("status", "title", "kind", "body"):
        with pytest.raises(ValidationError):
            AdminPatchRequest.model_validate({field: None})
    with pytest.raises(ValidationError):
        AdminPatchRequest.model_validate({"status": "shipped"})
    with pytest.raises(ValidationError):
        AdminPatchRequest.model_validate({"authorId": "2"})


def test_note_request():
    assert NoteRequest.model_validate({"body": " hi "}).body == "hi"
    assert NoteRequest.model_validate({"body": "x"}).visibility == "internal"
    with pytest.raises(ValidationError):
        NoteRequest.model_validate({"body": "   "})
    with pytest.raises(ValidationError):
        NoteRequest.model_validate({"body": "x", "visibility": "everyone"})


def test_clip_user_agent():
    assert clip_user_agent(None) is None
    assert clip_user_agent("a\x00b") == "ab"
    assert len(clip_user_agent("x" * 900) or "") == 500
