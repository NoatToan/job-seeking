"""OTP email delivery: Resend's HTTP API when configured, a `devCode` in review mode otherwise.

Never logs the OTP code itself (see `deliver_otp`/`_send_via_resend`: the code only ever appears
inside the request body sent to Resend, or in the `devCode` the caller returns to the client).
"""

import logging

import httpx

from ujc_api.settings import Settings

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
_TIMEOUT_S = 10.0


class MailNotConfigured(Exception):
    """Neither `RESEND_API_KEY` nor `UJC_OTP_REVIEW_MODE` is set: there is no way to deliver."""


class NotInvited(Exception):
    """Review mode is on with a non-empty allowlist, this email isn't on it, and no `RESEND_API_KEY`
    is configured to send it a real email instead."""


class MailDeliveryFailed(Exception):
    """Resend was configured but the send itself failed (network error / non-2xx response)."""


def _otp_subject_and_body(code: str) -> tuple[str, str]:
    subject = "Your sign-in code"
    body = (
        f"<p>Your sign-in code is <strong>{code}</strong>.</p>"
        "<p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>"
    )
    return subject, body


def _send_via_resend(settings: Settings, email: str, code: str) -> None:
    subject, html = _otp_subject_and_body(code)
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.ujc_mail_from, "to": [email], "subject": subject, "html": html},
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Resend delivery failed: %s", type(exc).__name__)
        raise MailDeliveryFailed("could not send the sign-in email") from exc


def deliver_otp(settings: Settings, email: str, code: str) -> str | None:
    """Delivers (or simulates delivering) a 6-digit OTP code to `email`.

    Returns the `devCode` to echo back to the caller (review mode), or `None` when a real email
    was sent via Resend. Raises `NotInvited` (-> 403) or `MailNotConfigured` (-> 503) when the
    code cannot be delivered at all. See docs/product/FLOW_V2.md §2 "Email" for the precedence
    rules and the V2-01 review-allowlist addendum.
    """
    allowlist = settings.otp_review_allowlist()
    if settings.ujc_otp_review_mode and allowlist:
        if email.lower() in allowlist:
            return code
        if settings.resend_api_key:
            _send_via_resend(settings, email, code)
            return None
        raise NotInvited()

    # No allowlist configured (or review mode off): the original precedence — a configured
    # Resend key always wins, review mode is the fallback, and otherwise there is no mailer.
    if settings.resend_api_key:
        _send_via_resend(settings, email, code)
        return None
    if settings.ujc_otp_review_mode:
        return code
    raise MailNotConfigured()
