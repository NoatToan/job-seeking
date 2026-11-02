"""Pure (no DB) validation tests for the `applications` request models and status enum."""

import pytest
from pydantic import ValidationError

from ujc_api.routers.applications import (
    _STATUSES,
    CreateApplicationRequest,
    PatchApplicationRequest,
)
from ujc_api.validation import MAX_APPLICATION_NOTE_LEN


def test_create_request_defaults_status_to_saved():
    req = CreateApplicationRequest(jobId="42")
    assert req.status == "saved"
    assert req.note is None


def test_create_request_accepts_any_known_status():
    for status in _STATUSES:
        req = CreateApplicationRequest(jobId="1", status=status)
        assert req.status == status


def test_create_request_rejects_unknown_status():
    with pytest.raises(ValidationError):
        CreateApplicationRequest(jobId="1", status="not-a-status")


def test_create_request_rejects_oversized_note():
    with pytest.raises(ValidationError):
        CreateApplicationRequest(jobId="1", note="x" * (MAX_APPLICATION_NOTE_LEN + 1))


def test_create_request_accepts_note_at_the_limit():
    req = CreateApplicationRequest(jobId="1", note="x" * MAX_APPLICATION_NOTE_LEN)
    assert req.note is not None and len(req.note) == MAX_APPLICATION_NOTE_LEN


def test_patch_request_allows_partial_updates_and_tracks_which_fields_were_sent():
    req = PatchApplicationRequest(status="applied")
    assert req.model_fields_set == {"status"}

    req2 = PatchApplicationRequest(note="called them")
    assert req2.model_fields_set == {"note"}

    req3 = PatchApplicationRequest()
    assert req3.model_fields_set == set()


def test_patch_request_rejects_unknown_status():
    with pytest.raises(ValidationError):
        PatchApplicationRequest(status="not-a-status")


def test_patch_request_rejects_oversized_note():
    with pytest.raises(ValidationError):
        PatchApplicationRequest(note="x" * (MAX_APPLICATION_NOTE_LEN + 1))


def test_patch_request_parses_next_action_at_from_iso_string():
    req = PatchApplicationRequest(nextActionAt="2026-01-01T00:00:00Z")
    assert req.nextActionAt is not None
    assert req.nextActionAt.year == 2026
