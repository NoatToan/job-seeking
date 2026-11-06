"""Display identities for comments and anonymous feedback.

- **Anonymous visitors** get a random id in an HttpOnly cookie signed with a host secret
  (`VisitorCookies`). The id never leaves the cookie: the database and the API only ever see the
  *visitor key*, a keyed hash of it. From the key we derive a stable, meaningful pseudonym in the
  style of Facebook's anonymous members: adjective + animal ("Brave Otter" / "Rái cá dũng cảm"),
  a three-digit tag that tells two "Brave Otter"s apart, and an animal emoji + colour tone for
  the avatar. A visitor may choose their own display name instead (stored against the key).
- **Signed-in users** show their chosen display name, else the local part of their email. The
  full email is never shown publicly.

Pure functions plus one small cookie helper; no database access here.
"""

import hashlib
import hmac
import re
import secrets
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Request, Response

from contributor_box.constants import DISPLAY_NAME_MAX

# (en, vi). Vietnamese puts the adjective after the noun: "Rái cá dũng cảm".
ADJECTIVES: tuple[tuple[str, str], ...] = (
    ("Brave", "dũng cảm"),
    ("Curious", "tò mò"),
    ("Gentle", "hiền lành"),
    ("Clever", "lanh lợi"),
    ("Cheerful", "vui vẻ"),
    ("Calm", "điềm tĩnh"),
    ("Bold", "táo bạo"),
    ("Swift", "nhanh nhẹn"),
    ("Witty", "hóm hỉnh"),
    ("Kind", "tốt bụng"),
    ("Quiet", "trầm lặng"),
    ("Bright", "sáng dạ"),
    ("Lucky", "may mắn"),
    ("Patient", "kiên nhẫn"),
    ("Playful", "tinh nghịch"),
    ("Wise", "thông thái"),
    ("Friendly", "thân thiện"),
    ("Honest", "thật thà"),
    ("Humble", "khiêm tốn"),
    ("Jolly", "vui tính"),
    ("Lively", "hoạt bát"),
    ("Loyal", "trung thành"),
    ("Merry", "hớn hở"),
    ("Nimble", "khéo léo"),
    ("Polite", "lễ phép"),
    ("Sunny", "rạng rỡ"),
    ("Thoughtful", "chu đáo"),
    ("Tidy", "gọn gàng"),
    ("Eager", "hăng hái"),
    ("Daring", "gan dạ"),
    ("Dreamy", "mơ mộng"),
    ("Generous", "hào phóng"),
    ("Hopeful", "lạc quan"),
    ("Mighty", "mạnh mẽ"),
    ("Noble", "cao thượng"),
    ("Sleepy", "ngái ngủ"),
    ("Steady", "vững vàng"),
    ("Spirited", "sôi nổi"),
    ("Chatty", "hay chuyện"),
    ("Tiny", "tí hon"),
    ("Fluffy", "lông xù"),
    ("Sparkly", "lấp lánh"),
    ("Cozy", "ấm áp"),
    ("Breezy", "thong dong"),
    ("Silly", "ngộ nghĩnh"),
    ("Smart", "thông minh"),
    ("Speedy", "thần tốc"),
    ("Mellow", "dịu dàng"),
)

# (en, vi, emoji). All animals, so the avatar always matches the name.
ANIMALS: tuple[tuple[str, str, str], ...] = (
    ("Otter", "Rái cá", "🦦"),
    ("Fox", "Cáo", "🦊"),
    ("Owl", "Cú mèo", "🦉"),
    ("Panda", "Gấu trúc", "🐼"),
    ("Tiger", "Hổ", "🐯"),
    ("Rabbit", "Thỏ", "🐰"),
    ("Turtle", "Rùa", "🐢"),
    ("Dolphin", "Cá heo", "🐬"),
    ("Penguin", "Chim cánh cụt", "🐧"),
    ("Koala", "Gấu túi", "🐨"),
    ("Hedgehog", "Nhím", "🦔"),
    ("Squirrel", "Sóc", "🐿️"),
    ("Elephant", "Voi", "🐘"),
    ("Giraffe", "Hươu cao cổ", "🦒"),
    ("Zebra", "Ngựa vằn", "🦓"),
    ("Lion", "Sư tử", "🦁"),
    ("Wolf", "Sói", "🐺"),
    ("Bear", "Gấu", "🐻"),
    ("Cat", "Mèo", "🐱"),
    ("Puppy", "Cún", "🐶"),
    ("Monkey", "Khỉ", "🐵"),
    ("Parrot", "Vẹt", "🦜"),
    ("Peacock", "Công", "🦚"),
    ("Swan", "Thiên nga", "🦢"),
    ("Flamingo", "Hồng hạc", "🦩"),
    ("Whale", "Cá voi", "🐳"),
    ("Octopus", "Bạch tuộc", "🐙"),
    ("Crab", "Cua", "🦀"),
    ("Bee", "Ong", "🐝"),
    ("Butterfly", "Bướm", "🦋"),
    ("Ladybug", "Bọ rùa", "🐞"),
    ("Snail", "Ốc sên", "🐌"),
    ("Frog", "Ếch", "🐸"),
    ("Duck", "Vịt", "🦆"),
    ("Chick", "Gà con", "🐤"),
    ("Buffalo", "Trâu", "🐃"),
    ("Deer", "Nai", "🦌"),
    ("Raccoon", "Gấu mèo", "🦝"),
    ("Sloth", "Con lười", "🦥"),
    ("Seal", "Hải cẩu", "🦭"),
    ("Hamster", "Chuột hamster", "🐹"),
    ("Unicorn", "Kỳ lân", "🦄"),
    ("Dragon", "Rồng", "🐉"),
    ("Shark", "Cá mập", "🦈"),
    ("Kangaroo", "Chuột túi", "🦘"),
    ("Llama", "Lạc đà", "🦙"),
    ("Badger", "Lửng", "🦡"),
    ("Beaver", "Hải ly", "🦫"),
)

# Avatar background tones; the UI maps each to a theme token pair (so dark mode works).
TONES = 5


@dataclass(frozen=True)
class Pseudonym:
    en: str
    vi: str
    tag: str
    emoji: str
    tone: int


def _digest(label: str, key: str) -> bytes:
    return hashlib.sha256(f"contributor-box:{label}:{key}".encode()).digest()


def pseudonym(visitor_key: str) -> Pseudonym:
    """Deterministic: the same visitor key always gives the same name, tag and avatar."""
    d = _digest("pseudonym", visitor_key)
    adj = ADJECTIVES[int.from_bytes(d[0:2], "big") % len(ADJECTIVES)]
    animal = ANIMALS[int.from_bytes(d[2:4], "big") % len(ANIMALS)]
    tag = int.from_bytes(d[4:6], "big") % 1000
    return Pseudonym(
        en=f"{adj[0]} {animal[0]}",
        vi=f"{animal[1]} {adj[1]}",
        tag=f"{tag:03d}",
        emoji=animal[2],
        tone=d[6] % TONES,
    )


def tone_for(seed: str) -> int:
    return _digest("tone", seed)[0] % TONES


def email_local_part(email: str | None) -> str:
    if not email:
        return "?"
    return email.split("@", 1)[0][:DISPLAY_NAME_MAX] or "?"


def initial(name: str) -> str:
    return name[:1].upper() if name else "?"


# Names that would pass for the team or the system. Compared after case-folding and dropping
# spaces, punctuation and Vietnamese diacritics ("Quản trị" -> "quantri").
_RESERVED = {
    "admin",
    "administrator",
    "moderator",
    "mod",
    "team",
    "theteam",
    "staff",
    "support",
    "system",
    "official",
    "deleted",
    "removed",
    "anonymous",
    "guest",
    "quantri",
    "quantrivien",
    "doingu",
    "nhomphattrien",
    "hotro",
    "andanh",
    "khach",
}


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold().replace("đ", "d"))
    return "".join(ch for ch in decomposed if ch.isalnum() and not unicodedata.combining(ch))


def clean_display_name(value: str) -> str:
    """Normalises a chosen display name or raises ValueError (the message is the field error)."""
    value = unicodedata.normalize("NFC", value)
    if any(unicodedata.category(ch) in ("Cc", "Cf", "Co", "Cs") for ch in value):
        raise ValueError("must not contain control or invisible characters")
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        raise ValueError("must not be empty")
    if len(value) > DISPLAY_NAME_MAX:
        raise ValueError(f"must be at most {DISPLAY_NAME_MAX} characters")
    if "@" in value:
        raise ValueError("must not contain @")
    if _fold(value) in _RESERVED:
        raise ValueError("is reserved")
    return value


def public_author(
    *,
    user_id: int | None,
    email: str | None,
    user_name: str | None,
    visitor_key: str | None,
    visitor_name: str | None,
    by_team: bool = False,
) -> dict[str, Any] | None:
    """Public identity of an author (`None` when there is none, e.g. a deleted comment).

    `name` is what to show: the chosen name, or a user's email local part; `None` for a visitor
    without a chosen name, whose `pseudonym` (en / vi) the UI shows in the page's language.
    """
    if user_id is not None:
        name = user_name or email_local_part(email)
        return {
            "kind": "user",
            "name": name,
            "pseudonym": None,
            "tag": None,
            "avatar": {"glyph": initial(name), "tone": tone_for(f"user:{user_id}")},
            "team": bool(by_team),
        }
    if visitor_key is not None:
        p = pseudonym(visitor_key)
        return {
            "kind": "guest",
            "name": visitor_name,
            "pseudonym": {"en": p.en, "vi": p.vi},
            "tag": p.tag,
            "avatar": {"glyph": p.emoji, "tone": p.tone},
            "team": False,
        }
    return None


def visitor_label(visitor_key: str, visitor_name: str | None) -> str:
    """One-line label for admin screens: "Minh (Brave Otter #123)" or "Brave Otter #123"."""
    p = pseudonym(visitor_key)
    base = f"{p.en} #{p.tag}"
    return f"{visitor_name} ({base})" if visitor_name else base


# --- the visitor cookie --------------------------------------------------------------------------

VISITOR_COOKIE = "cb_visitor"
# Browsers cap cookie lifetime at 400 days.
VISITOR_COOKIE_MAX_AGE = 400 * 24 * 3600


@dataclass(frozen=True)
class Visitor:
    """An anonymous visitor. `key` is safe to store; the cookie's id is not exposed anywhere."""

    key: str


class VisitorCookies:
    """Issues and verifies the anonymous visitor cookie: `v1.<random id>.<HMAC signature>`,
    HttpOnly, SameSite=Lax. Build one per request in a host dependency (so the secret and the
    `secure` flag come from the host's settings) and pass that dependency as
    `FeedbackDeps.visitor_cookies`."""

    def __init__(
        self,
        secret: str | Callable[[], str],
        *,
        secure: bool = True,
        cookie_name: str = VISITOR_COOKIE,
        max_age: int = VISITOR_COOKIE_MAX_AGE,
        path: str = "/",
    ) -> None:
        self._secret = secret
        self.secure = secure
        self.cookie_name = cookie_name
        self.max_age = max_age
        self.path = path

    def _key_bytes(self) -> bytes:
        secret = self._secret() if callable(self._secret) else self._secret
        if not secret:
            raise RuntimeError("VisitorCookies needs a non-empty secret")
        return secret.encode()

    def _mac(self, label: str, visitor_id: str) -> str:
        return hmac.new(self._key_bytes(), f"{label}:{visitor_id}".encode(), "sha256").hexdigest()

    def read(self, request: Request) -> Visitor | None:
        raw = request.cookies.get(self.cookie_name)
        if not raw or len(raw) > 200:
            return None
        parts = raw.split(".")
        if len(parts) != 3 or parts[0] != "v1" or not parts[1]:
            return None
        if not hmac.compare_digest(parts[2], self._mac("cb-visitor-cookie", parts[1])[:32]):
            return None
        return Visitor(key=self._mac("cb-visitor-key", parts[1]))

    def issue(self, response: Response) -> Visitor:
        visitor_id = secrets.token_urlsafe(18)
        signature = self._mac("cb-visitor-cookie", visitor_id)[:32]
        response.set_cookie(
            self.cookie_name,
            f"v1.{visitor_id}.{signature}",
            max_age=self.max_age,
            httponly=True,
            secure=self.secure,
            samesite="lax",
            path=self.path,
        )
        return Visitor(key=self._mac("cb-visitor-key", visitor_id))

    def read_or_issue(self, request: Request, response: Response) -> Visitor:
        return self.read(request) or self.issue(response)
