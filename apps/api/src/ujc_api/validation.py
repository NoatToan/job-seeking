"""Small shared validators (no `pydantic[email]`/`email-validator` dependency needed)."""

import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAX_KEYWORDS = 30
MAX_KEYWORD_LEN = 40


def normalize_email(value: str) -> str:
    """Lower-cased, stripped email, or raises `ValueError` if it doesn't look like one."""
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("invalid email")
    return value
