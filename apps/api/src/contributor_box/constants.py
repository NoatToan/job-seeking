"""Enumerations and limits shared by validation, the repository and the router.

Every limit here is also enforced by a CHECK constraint in `sql/*.sql`; the API checks
first so the client gets a 400 with a field name instead of a 500 from the database.
"""

from typing import Literal

Kind = Literal["bug", "feedback", "idea"]
Status = Literal["new", "under_review", "approved", "planned", "done", "rejected"]
NoteVisibility = Literal["internal", "public"]

KINDS: tuple[str, ...] = ("bug", "feedback", "idea")
STATUSES: tuple[str, ...] = ("new", "under_review", "approved", "planned", "done", "rejected")
# Statuses every signed-in user can see on the board (and vote on). Everything else is visible
# only to the item's author and to admins.
PUBLIC_STATUSES: tuple[str, ...] = ("approved", "planned", "done")

TITLE_MIN = 3
TITLE_MAX = 140
BODY_MAX = 5000
PAGE_URL_MAX = 2048
PAGE_TITLE_MAX = 300
SELECTOR_MAX = 1000
ELEMENT_TEXT_MAX = 300
USER_AGENT_MAX = 500
NOTE_MAX = 5000
ADMIN_RESPONSE_MAX = 5000
VIEWPORT_MAX = 20000
REGION_MAX = 100_000

# Decoded screenshot bytes. The widget compresses to JPEG well below this (typically 100-400 KB).
SCREENSHOT_MAX_BYTES = 1_500_000
# base64 grows 4/3, plus the `data:image/jpeg;base64,` prefix.
SCREENSHOT_MAX_DATA_URL_CHARS = (SCREENSHOT_MAX_BYTES * 4) // 3 + 64
# The whole POST body (JSON with the screenshot inside). Hosts with a body-size middleware must
# allow at least this much on `POST <prefix>`.
CREATE_MAX_BODY_BYTES = 2_200_000

# Per author, rolling hour. Counted in the database, so it holds across processes/instances.
MAX_ITEMS_PER_HOUR = 10
# Anonymous submissions (only when the host opts in with `allow_anonymous=True`): per anonymous
# key (the host's salted hash of the client IP) and, as a backstop against rotating IPs, across all
# anonymous visitors together. Rolling hour, counted in the database.
MAX_ANON_ITEMS_PER_HOUR = 5
MAX_ANON_ITEMS_PER_HOUR_TOTAL = 60
AUTHOR_NAME_MAX = 80
ANON_KEY_MAX = 128

LIST_LIMIT_DEFAULT = 20
LIST_LIMIT_MAX = 50
