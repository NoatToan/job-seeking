"""Pure (no DB) validation tests for the privacy request models (M5-04)."""

import pytest
from pydantic import ValidationError

from ujc_api.routers.me import ConsentRequest, DeleteAccountRequest


def test_consent_request_accepts_true():
    req = ConsentRequest(aiProcessing=True)
    assert req.aiProcessing is True


def test_consent_request_rejects_false():
    with pytest.raises(ValidationError):
        ConsentRequest(aiProcessing=False)


def test_delete_account_request_requires_literal_delete():
    req = DeleteAccountRequest(confirm="DELETE")
    assert req.confirm == "DELETE"
    with pytest.raises(ValidationError):
        DeleteAccountRequest(confirm="delete")
    with pytest.raises(ValidationError):
        DeleteAccountRequest(confirm="yes")
