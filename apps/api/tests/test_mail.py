"""`deliver_otp` precedence, including the V2-01 review-build allowlist."""

import httpx
import pytest

from ujc_api import mail
from ujc_api.settings import Settings


def _settings(**overrides) -> Settings:
    base = {"_env_file": None, "ujc_secret_key": "unit-test-secret", "ujc_env": "test"}
    base.update(overrides)
    return Settings(**base)


def test_neither_resend_nor_review_mode_raises_mail_not_configured():
    settings = _settings()
    with pytest.raises(mail.MailNotConfigured):
        mail.deliver_otp(settings, "a@example.com", "123456")


def test_review_mode_without_allowlist_returns_dev_code_for_anyone():
    settings = _settings(ujc_otp_review_mode=True)
    assert mail.deliver_otp(settings, "anyone@example.com", "123456") == "123456"


def test_resend_key_set_sends_a_real_email_and_returns_no_dev_code(monkeypatch):
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent["url"] = url
        sent["json"] = json
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    settings = _settings(resend_api_key="re_test_key", ujc_otp_review_mode=True)
    result = mail.deliver_otp(settings, "a@example.com", "123456")
    assert result is None
    assert sent["json"]["to"] == ["a@example.com"]
    assert "123456" in sent["json"]["html"]


def test_resend_failure_raises_mail_delivery_failed(monkeypatch):
    def fake_post(url, headers=None, json=None, timeout=None):
        return httpx.Response(500, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    settings = _settings(resend_api_key="re_test_key")
    with pytest.raises(mail.MailDeliveryFailed):
        mail.deliver_otp(settings, "a@example.com", "123456")


def test_allowlist_set_gives_dev_code_only_to_allowlisted_email():
    settings = _settings(ujc_otp_review_mode=True, ujc_otp_review_allowlist="Allowed@Example.com")
    assert mail.deliver_otp(settings, "allowed@example.com", "123456") == "123456"


def test_allowlist_set_rejects_other_emails_without_resend():
    settings = _settings(ujc_otp_review_mode=True, ujc_otp_review_allowlist="allowed@example.com")
    with pytest.raises(mail.NotInvited):
        mail.deliver_otp(settings, "stranger@example.com", "123456")


def test_allowlist_set_sends_other_emails_via_resend_when_configured(monkeypatch):
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent["to"] = json["to"]
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    settings = _settings(
        ujc_otp_review_mode=True,
        ujc_otp_review_allowlist="allowed@example.com",
        resend_api_key="re_test_key",
    )
    result = mail.deliver_otp(settings, "stranger@example.com", "123456")
    assert result is None
    assert sent["to"] == ["stranger@example.com"]


def test_allowlist_set_still_gives_dev_code_to_allowlisted_email_even_with_resend_configured(
    monkeypatch,
):
    called = []
    monkeypatch.setattr(httpx, "post", lambda *a, **k: called.append(1))
    settings = _settings(
        ujc_otp_review_mode=True,
        ujc_otp_review_allowlist="allowed@example.com",
        resend_api_key="re_test_key",
    )
    result = mail.deliver_otp(settings, "allowed@example.com", "123456")
    assert result == "123456"
    assert called == []  # Resend was never called for the allowlisted address
