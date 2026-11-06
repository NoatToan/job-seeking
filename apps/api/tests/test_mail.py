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


def test_resend_rejection_maps_to_mail_failed_502(monkeypatch):
    """A Resend non-2xx (e.g. unverified sending domain) is a clean 502, not a 500."""
    import httpx

    from ujc_api import mail
    from ujc_api.settings import Settings

    def fake_post(url, **kwargs):
        request = httpx.Request("POST", url)
        return httpx.Response(
            403,
            request=request,
            json={"name": "validation_error", "message": "You can only send testing emails"},
        )

    monkeypatch.setattr(mail.httpx, "post", fake_post)
    settings = Settings(resend_api_key="re_test", ujc_otp_review_mode=False, ujc_env="test")
    import pytest

    with pytest.raises(mail.MailDeliveryFailed):
        mail.deliver_otp(settings, "someone@example.com", "123456")


def test_otp_email_is_branded_with_absolute_images_and_a_text_part(monkeypatch):
    sent = {}

    def fake_post(url, **kwargs):
        sent.update(kwargs)
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(mail.httpx, "post", fake_post)
    settings = Settings(resend_api_key="re_test", ujc_public_url="http://localhost:3000")
    mail.deliver_otp(settings, "a@example.com", "482913")
    body = sent["json"]
    assert body["subject"].startswith("482913")
    # The code is one unbroken string (copy-paste), images are absolute https (dev falls back).
    assert ">482913</div>" in body["html"]
    assert "https://unified-job-crawler.vercel.app/email/logo.png" in body["html"]
    assert "https://unified-job-crawler.vercel.app/email/banner.png" in body["html"]
    assert "482913" in body["text"]
    assert "$" not in body["html"]
