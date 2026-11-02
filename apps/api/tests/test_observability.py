from unittest.mock import patch

from ujc_api.observability import _before_send, init_sentry
from ujc_api.settings import Settings


def test_init_sentry_is_a_noop_without_a_dsn():
    settings = Settings(_env_file=None, ujc_env="test")
    with patch("sentry_sdk.init") as mock_init:
        init_sentry(settings)
    mock_init.assert_not_called()


def test_init_sentry_initializes_the_sdk_when_dsn_is_set():
    settings = Settings(
        _env_file=None, ujc_env="test", sentry_dsn="https://public@o0.ingest.sentry.io/1"
    )
    with patch("sentry_sdk.init") as mock_init:
        init_sentry(settings)
    mock_init.assert_called_once()
    _, kwargs = mock_init.call_args
    assert kwargs["dsn"] == settings.sentry_dsn
    assert kwargs["send_default_pii"] is False
    assert callable(kwargs["before_send"])


def test_before_send_strips_request_data_cookies_headers_and_query_string():
    """No CV text, emails, cookies or tokens ever leave the process in a Sentry event
    (docs/product/SECURITY.md)."""
    event = {
        "request": {
            "data": {"email": "person@example.com"},
            "cookies": {"ujc_session": "abc"},
            "headers": {"Authorization": "Bearer secret-token"},
            "query_string": "token=abc",
            "url": "https://jobs.example.com/api/me",
            "method": "GET",
        }
    }

    result = _before_send(event, {})

    assert result is not None
    request = result["request"]
    assert "data" not in request
    assert "cookies" not in request
    assert "headers" not in request
    assert "query_string" not in request
    # Non-sensitive fields survive: this is still useful for triage.
    assert request["url"] == "https://jobs.example.com/api/me"
    assert request["method"] == "GET"


def test_before_send_tolerates_an_event_without_a_request():
    event = {"message": "boom"}
    assert _before_send(event, {}) == {"message": "boom"}
