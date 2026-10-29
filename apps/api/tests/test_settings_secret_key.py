"""UJC_SECRET_KEY, OTP review mode and the review allowlist (V2-01)."""

import pytest

from ujc_api.settings import DEV_DEFAULT_SECRET_KEY, Settings


def test_development_without_secret_key_uses_the_derived_default_and_warns(monkeypatch, caplog):
    monkeypatch.delenv("UJC_SECRET_KEY", raising=False)
    monkeypatch.delenv("UJC_ENV", raising=False)
    with caplog.at_level("WARNING"):
        settings = Settings(_env_file=None)
    assert settings.ujc_secret_key == DEV_DEFAULT_SECRET_KEY
    assert any("UJC_SECRET_KEY" in r.message for r in caplog.records)


def test_test_env_without_secret_key_does_not_raise(monkeypatch):
    monkeypatch.delenv("UJC_SECRET_KEY", raising=False)
    monkeypatch.setenv("UJC_ENV", "test")
    settings = Settings(_env_file=None)
    assert settings.ujc_secret_key == DEV_DEFAULT_SECRET_KEY


def test_production_without_secret_key_raises(monkeypatch):
    monkeypatch.delenv("UJC_SECRET_KEY", raising=False)
    monkeypatch.setenv("UJC_ENV", "production")
    with pytest.raises(ValueError, match="UJC_SECRET_KEY"):
        Settings(_env_file=None)


def test_production_with_secret_key_is_fine(monkeypatch):
    monkeypatch.setenv("UJC_ENV", "production")
    monkeypatch.setenv("UJC_SECRET_KEY", "a-real-secret")
    settings = Settings(_env_file=None)
    assert settings.ujc_secret_key == "a-real-secret"


def test_production_with_the_dev_default_explicitly_set_still_raises(monkeypatch):
    monkeypatch.setenv("UJC_ENV", "production")
    monkeypatch.setenv("UJC_SECRET_KEY", DEV_DEFAULT_SECRET_KEY)
    with pytest.raises(ValueError, match="UJC_SECRET_KEY"):
        Settings(_env_file=None)


def test_otp_review_mode_and_mail_defaults(monkeypatch):
    monkeypatch.delenv("UJC_OTP_REVIEW_MODE", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("UJC_MAIL_FROM", raising=False)
    monkeypatch.delenv("UJC_OTP_REVIEW_ALLOWLIST", raising=False)
    settings = Settings(_env_file=None)
    assert settings.ujc_otp_review_mode is False
    assert settings.resend_api_key is None
    assert settings.ujc_mail_from == "Job Seeking <onboarding@resend.dev>"
    assert settings.otp_review_allowlist() == frozenset()


def test_otp_review_allowlist_is_parsed_case_insensitively(monkeypatch):
    monkeypatch.setenv("UJC_OTP_REVIEW_ALLOWLIST", " Alice@Example.com, bob@example.com ,")
    settings = Settings(_env_file=None)
    assert settings.otp_review_allowlist() == {"alice@example.com", "bob@example.com"}
