"""Personal session crawler for sites without an open API (LinkedIn, Seek).

It drives a *visible* Chromium window with a persistent browser profile on the user's own
machine: the user logs in by hand once (`login`), and later runs (`crawl`) reuse that profile.
Cookies never leave the machine and are never stored in our database.

Guardrails (see the research report — these sites forbid automated access, so keep it personal
and low-volume): a few result pages per search profile, slow randomised pacing, and when a
CAPTCHA / security checkpoint appears it stops and waits for the user to solve it in the window.
It does not solve or bypass CAPTCHAs and does not spoof browser fingerprints.
"""
