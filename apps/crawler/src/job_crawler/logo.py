"""Company logo for a job (Slack: "each job is missing its company logo").

1. The logo the source sends with the job: Himalayas `companyLogo`, Remotive `company_logo`,
   SEEK `branding.serpLogoUrl`.
2. Otherwise the company's own site, when the job (or apply) link points at it rather than at a
   job board (e.g. Stripe's Greenhouse jobs link to stripe.com/jobs/...): its icon from
   DuckDuckGo's icon service, which answers 404 for unknown sites so the app falls back to
   initials.
3. Otherwise None: the app shows the company's initials.

Only https URLs are returned (the web CSP lists the hosts in `LOGO_HOSTS`).
"""

from typing import Any
from urllib.parse import quote, urlsplit

ICON_SERVICE = "https://icons.duckduckgo.com/ip3/{domain}.ico"

# Hosts the app loads logos from; keep in sync with img-src in vercel.json and deploy/Caddyfile.
LOGO_HOSTS = (
    "cdn-images.himalayas.app",
    "remotive.com",
    "bx-branding-gateway.cloud.seek.com.au",
    "icons.duckduckgo.com",
)

# Job boards / ATS hosts: their icon would be the board's, not the employer's.
_BOARD_DOMAINS = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "himalayas.app",
    "remotive.com",
    "remotive.io",
    "weworkremotely.com",
    "seek.com.au",
    "seek.co.nz",
    "seek.com",
    "arc.dev",
    "linkedin.com",
    "glassdoor.com",
    "adzuna.com",
    "adzuna.com.au",
    "upwork.com",
    "workable.com",
    "smartrecruiters.com",
    "myworkdayjobs.com",
    "workday.com",
    "bamboohr.com",
    "recruitee.com",
    "teamtailor.com",
    "breezy.hr",
    "jobvite.com",
    "icims.com",
    "personio.de",
    "personio.com",
    "rippling.com",
    "dover.com",
    "wellfound.com",
    "ycombinator.com",
    "workatastartup.com",
    "indeed.com",
    "google.com",
    "forms.gle",
    "notion.site",
    "typeform.com",
    "bit.ly",
)

# Second-level labels under a country code: example.com.au keeps three labels.
_SECOND_LEVEL = {"com", "co", "net", "org", "gov", "edu", "ac"}


def _https(url: Any) -> str | None:
    if not isinstance(url, str):
        return None
    url = url.strip()
    return url if url.startswith("https://") and len(url) <= 500 else None


def source_logo(raw: dict[str, Any] | None) -> str | None:
    raw = raw or {}
    branding = raw.get("branding")
    candidates = [
        raw.get("companyLogo"),
        raw.get("company_logo"),
        raw.get("company_logo_url"),
        branding.get("serpLogoUrl") if isinstance(branding, dict) else None,
    ]
    return next((u for u in map(_https, candidates) if u), None)


def site_domain(url: str | None) -> str | None:
    """The registrable domain of `url` ("stripe.com" for https://jobs.stripe.com/x), or None for
    job boards, IPs and anything that isn't a plain web host."""
    if not url:
        return None
    try:
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return None
    labels = host.split(".")
    if len(labels) < 2 or not all(labels) or labels[-1].isdigit():
        return None
    keep = 3 if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL else 2
    domain = ".".join(labels[-keep:])
    if any(domain == b or domain.endswith("." + b) for b in _BOARD_DOMAINS):
        return None
    return domain


def job_logo(url: str | None, apply_url: str | None, raw: dict[str, Any] | None) -> str | None:
    found = source_logo(raw)
    if found:
        return found
    for link in (url, apply_url):
        domain = site_domain(link)
        if domain:
            return ICON_SERVICE.format(domain=quote(domain))
    return None
