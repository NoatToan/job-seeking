"""OTP hash/verify/expiry/attempt logic, against FakeOtpConn (no real database)."""

from datetime import UTC, datetime, timedelta

import pytest
from fakes import FakeOtpConn

from ujc_api.auth import otp
from ujc_api.auth.ratelimit import SlidingWindowRateLimiter
from ujc_api.settings import Settings


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, ujc_secret_key="unit-test-secret", ujc_env="test")


def test_generate_code_is_six_digits():
    for _ in range(50):
        code = otp.generate_code()
        assert len(code) == 6
        assert code.isdigit()


def test_hash_code_is_deterministic_and_keyed_by_secret_email_and_code():
    h1 = otp.hash_code("secret-a", "a@example.com", "123456")
    h2 = otp.hash_code("secret-a", "a@example.com", "123456")
    assert h1 == h2
    assert h1 != otp.hash_code("secret-b", "a@example.com", "123456")
    assert h1 != otp.hash_code("secret-a", "b@example.com", "123456")
    assert h1 != otp.hash_code("secret-a", "a@example.com", "654321")


def test_create_then_verify_succeeds(settings):
    conn = FakeOtpConn()
    code, expires_in = otp.create(conn, settings, "a@example.com")
    assert expires_in == 600
    otp.verify(conn, settings, "a@example.com", code)  # does not raise


def test_verify_consumes_the_code_so_it_cannot_be_reused(settings):
    conn = FakeOtpConn()
    code, _ = otp.create(conn, settings, "a@example.com")
    otp.verify(conn, settings, "a@example.com", code)
    with pytest.raises(otp.InvalidCode):
        otp.verify(conn, settings, "a@example.com", code)


def test_verify_wrong_code_raises_invalid_code(settings):
    conn = FakeOtpConn()
    otp.create(conn, settings, "a@example.com")
    with pytest.raises(otp.InvalidCode):
        otp.verify(conn, settings, "a@example.com", "000000")


def test_verify_unknown_email_raises_invalid_code(settings):
    conn = FakeOtpConn()
    with pytest.raises(otp.InvalidCode):
        otp.verify(conn, settings, "nobody@example.com", "123456")


def test_verify_expired_code_raises_code_expired(settings):
    clock = {"t": datetime.now(UTC)}
    conn = FakeOtpConn(now=lambda: clock["t"])
    code, _ = otp.create(conn, settings, "a@example.com")
    clock["t"] += timedelta(minutes=11)
    with pytest.raises(otp.CodeExpired):
        otp.verify(conn, settings, "a@example.com", code, now=lambda: clock["t"])


def test_five_wrong_attempts_raises_too_many_attempts(settings):
    conn = FakeOtpConn()
    otp.create(conn, settings, "a@example.com")
    for _ in range(4):
        with pytest.raises(otp.InvalidCode):
            otp.verify(conn, settings, "a@example.com", "000000")
    with pytest.raises(otp.TooManyAttempts):
        otp.verify(conn, settings, "a@example.com", "000000")


def test_too_many_attempts_persists_even_with_the_right_code(settings):
    conn = FakeOtpConn()
    code, _ = otp.create(conn, settings, "a@example.com")
    for _ in range(5):
        with pytest.raises((otp.InvalidCode, otp.TooManyAttempts)):
            otp.verify(conn, settings, "a@example.com", "000000")
    with pytest.raises(otp.TooManyAttempts):
        otp.verify(conn, settings, "a@example.com", code)


def test_email_rate_limit_blocks_within_60_seconds(settings):
    conn = FakeOtpConn()
    otp.create(conn, settings, "a@example.com")
    with pytest.raises(otp.RateLimited) as exc_info:
        otp.check_email_rate_limit(conn, "a@example.com")
    assert exc_info.value.retry_after == 60


def test_email_rate_limit_blocks_the_sixth_in_an_hour(settings):
    conn = FakeOtpConn()
    now = datetime.now(UTC)
    for i in range(5):
        conn.rows.append(
            {
                "id": i,
                "email": "a@example.com",
                "code_hash": "x",
                "expires_at": now,
                "attempts": 0,
                "consumed_at": None,
                "created_at": now - timedelta(minutes=50),
            }
        )
    with pytest.raises(otp.RateLimited) as exc_info:
        otp.check_email_rate_limit(conn, "a@example.com")
    assert exc_info.value.retry_after == 3600


def test_email_rate_limit_allows_a_different_email():
    conn = FakeOtpConn()
    conn.rows.append(
        {
            "id": 1,
            "email": "a@example.com",
            "code_hash": "x",
            "expires_at": datetime.now(UTC),
            "attempts": 0,
            "consumed_at": None,
            "created_at": datetime.now(UTC),
        }
    )
    otp.check_email_rate_limit(conn, "b@example.com")  # does not raise


def test_ip_rate_limiter_blocks_after_max_count():
    clock = {"t": 0.0}
    limiter = SlidingWindowRateLimiter(max_count=3, window_seconds=3600, clock=lambda: clock["t"])
    for _ in range(3):
        assert limiter.allow("1.2.3.4") is True
    assert limiter.allow("1.2.3.4") is False


def test_ip_rate_limiter_window_expires():
    clock = {"t": 0.0}
    limiter = SlidingWindowRateLimiter(max_count=1, window_seconds=60, clock=lambda: clock["t"])
    assert limiter.allow("1.2.3.4") is True
    assert limiter.allow("1.2.3.4") is False
    clock["t"] += 61
    assert limiter.allow("1.2.3.4") is True


def test_ip_rate_limiter_keys_are_independent():
    limiter = SlidingWindowRateLimiter(max_count=1, window_seconds=3600)
    assert limiter.allow("1.1.1.1") is True
    assert limiter.allow("2.2.2.2") is True
