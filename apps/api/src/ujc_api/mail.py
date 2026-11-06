"""Mail delivery: Resend's HTTP API when configured. `deliver_otp` falls back to a `devCode` in
review mode; `deliver_digest` (M4-08) falls back to logging "would send" (never logs job
content, just the count — see its docstring).
"""

import logging
from pathlib import Path
from string import Template
from typing import Any

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


# Images in emails must be absolute https URLs on a public host. A local `ujc_public_url` (dev)
# falls back to production so a test email still shows them. Files: apps/web/public/email/.
_PROD_ORIGIN = "https://job-seeking-remote.vercel.app"


# Branded HTML body (string.Template: $code, $home, $logo, $banner, ...). Values are our
# own digits and URLs, never user input.
_OTP_TEMPLATE = Template(
    (Path(__file__).parent / "templates" / "otp_email.html").read_text(encoding="utf-8")
)


def _asset_url(settings: Settings, name: str) -> str:
    origin = settings.ujc_public_url.rstrip("/")
    if not origin.startswith("https://"):
        origin = _PROD_ORIGIN
    return f"{origin}/email/{name}"


def _otp_subject_and_body(code: str, settings: Settings) -> tuple[str, str]:
    """Branded sign-in email: table layout + inline styles (Gmail/Outlook ignore <style> and
    flexbox), PNG images (SVG is blocked by most clients), a dark-mode-safe palette, the code in a
    large monospace box, and a preheader so the inbox preview shows the code."""
    subject = f"{code} is your JobSeeking sign-in code"
    home = (
        settings.ujc_public_url.rstrip("/")
        if settings.ujc_public_url.startswith("https://")
        else _PROD_ORIGIN
    )
    body = _OTP_TEMPLATE.substitute(
        subject=subject,
        code=code,
        home=home,
        home_label=home.removeprefix("https://"),
        logo=_asset_url(settings, "logo.png"),
        banner=_asset_url(settings, "banner.png"),
    )
    return subject, body


def _otp_text(code: str) -> str:
    """Plain-text part: some clients and every spam filter read it."""
    return (
        f"Your JobSeeking sign-in code is {code}\n\n"
        "Enter it on JobSeeking to finish signing in. It expires in 10 minutes and works once.\n\n"
        "Didn't ask for this? You can ignore this email.\n"
    )


def _send_via_resend(settings: Settings, email: str, code: str) -> None:
    subject, html = _otp_subject_and_body(code, settings)
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.ujc_mail_from,
                "to": [email],
                "subject": subject,
                "html": html,
                "text": _otp_text(code),
            },
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Resend's error body names the reason (e.g. "validation_error: You can only send testing
        # emails to your own email address" until a sending domain is verified). It holds no secret.
        detail = exc.response.text[:300].replace("\n", " ")
        log.warning("Resend delivery failed: HTTP %s %s", exc.response.status_code, detail)
        raise MailDeliveryFailed("could not send the sign-in email") from exc
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


def _digest_subject(job_count: int) -> str:
    noun = "match" if job_count == 1 else "matches"
    return f"{job_count} new job {noun} for you"


def _job_line(job: dict[str, Any]) -> str:
    score = job.get("score")
    score_suffix = f" — {score}% match" if score is not None else ""
    source = job.get("source") or "source unknown"
    return f"{job['title']} at {job['company']} ({source}){score_suffix}\n{job['url']}"


def _digest_text(jobs: list[dict[str, Any]], app_url: str, unsubscribe_url: str) -> str:
    body = "\n\n".join(_job_line(j) for j in jobs)
    return (
        "Your daily job digest:\n\n"
        f"{body}\n\n"
        f"See more and change your digest settings: {app_url}/cv/\n"
        f"Unsubscribe from the daily digest: {unsubscribe_url}\n"
    )


def _digest_html(jobs: list[dict[str, Any]], app_url: str, unsubscribe_url: str) -> str:
    items = "".join(
        "<li>"
        f'<a href="{j["url"]}">{j["title"]}</a> at {j["company"]}'
        f' <span style="color:#8e8e93">({j.get("source") or "source unknown"})</span>'
        + (f" &mdash; {j['score']}% match" if j.get("score") is not None else "")
        + "</li>"
        for j in jobs
    )
    return (
        "<p>Your daily job digest:</p>"
        f"<ul>{items}</ul>"
        f'<p><a href="{app_url}/cv/">See more and change your digest settings</a></p>'
        '<p style="color:#8e8e93;font-size:12px">'
        f'<a href="{unsubscribe_url}">Unsubscribe</a> from the daily digest.</p>'
    )


def deliver_digest(
    settings: Settings,
    email: str,
    jobs: list[dict[str, Any]],
    *,
    unsubscribe_url: str,
    app_url: str,
) -> bool:
    """Sends the daily digest via Resend when `RESEND_API_KEY` is set. Otherwise logs that a
    digest *would* be sent (count only — never job titles, urls or any other content) and
    returns `False`, so `ujc_api.digest.run_digest` still records `last_digest_at` (one digest
    attempt per user per local day, whether or not a mailer is configured).

    Returns `True` iff an email was actually sent via Resend.
    """
    if not settings.resend_api_key:
        log.info("digest: would send to %s (%d job(s)) — RESEND_API_KEY not set", email, len(jobs))
        return False

    subject = _digest_subject(len(jobs))
    text = _digest_text(jobs, app_url, unsubscribe_url)
    html = _digest_html(jobs, app_url, unsubscribe_url)
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.ujc_mail_from,
                "to": [email],
                "subject": subject,
                "html": html,
                "text": text,
                "headers": {"List-Unsubscribe": f"<{unsubscribe_url}>"},
            },
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("digest: Resend delivery failed: %s", type(exc).__name__)
        raise MailDeliveryFailed("could not send the digest email") from exc
    return True
