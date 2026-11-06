"""Split a job description into canonical sections ("About us", "Requirements", "Benefits"…), so
the job detail can show every posting with the same headings, icons and order.

Regex + heuristics only, no LLM. Descriptions are stored as tidy plain text (`text.html_to_text` +
`text.normalize_description`: one block per line, list items as "- "), so headings are short lines:
"Requirements", "What you'll do:", "ABOUT US", "## Benefits", "**Perks**", and "Salary: $120k"
style key/value lines.

`parse_sections(description)` returns a list of sections in posting order:

    {"key": "requirements",          # one of SECTION_KEYS
     "heading": "What you'll bring",  # the posting's own heading (None for the intro)
     "body": "- 5+ years of …",       # the section's text, as stored (normalised plain text)
     "summary": "5+ years of …; …"}  # a short plain-text digest (first bullets / sentences)

Headings the synonym table does not know become `other` (heading kept). `VERSION` is stored next
to the result (`jobs.sections_version`): bump it after any rule change here or in `level.py` and
`python -m job_crawler --backfill-sections` (run nightly) re-parses every older row.
"""

import re
from typing import Any

VERSION = 1

# Display order (the web app renders canonical sections in this order whatever the posting's).
SECTION_KEYS = (
    "intro",
    "about_company",
    "about_role",
    "responsibilities",
    "requirements",
    "nice_to_have",
    "tech_stack",
    "compensation",
    "benefits",
    "location_remote",
    "hiring_process",
    "other",
    "equal_opportunity",
)

# Optional lead words before a heading ("Your responsibilities", "Key requirements", "The perks").
_LEAD = r"(?:(?:your|the|our|key|main|core|primary|essential|some|job|role|position)\s+)*"

# Synonym table: canonical key -> regexes over the normalised heading (lower case, no trailing
# punctuation, "’" -> "'"). Checked in order, first match wins, so specific phrases come first.
_SYNONYMS: list[tuple[str, list[str]]] = [
    (
        "equal_opportunity",
        [
            r".*\b(?:equal (?:employment )?opportunit|eeo\b|eoe\b|e-verify|diversity|inclusion|"
            r"belonging|accommodation|accessibility|reasonable adjustment|non-?discrimination|"
            r"affirmative action|pay transparency|our commitment|commitment to|dei\b|"
            r"chancengleichheit|diversit[eé]|igualdad)",
        ],
    ),
    # Before nice_to_have: "Annual base salary range (excluding bonus)" is pay, not a bonus.
    (
        "compensation",
        [r".*\b(?:salary|pay|compensation) (?:range|grade|band)s?\b.*"],
    ),
    (
        "nice_to_have",
        [
            r".*\b(?:nice[- ]to[- ]haves?|bonus(?: points)?|preferred|desired|desirable|"
            r"pluses|plus points?|a plus|it'?s a plus|good to have|great to have|extra credit|"
            r"would be (?:great|nice|a plus)|even better|ideally|optional|strong signals?|"
            r"stand out|set you apart|extra points|not required|helpful|excited about|"
            r"wünschenswert|von vorteil|atouts?|serait un plus|deseable|valorable|diferenciais|"
            r"diferenciar|điểm cộng|ưu tiên)",
        ],
    ),
    (
        "hiring_process",
        [
            r".*\b(?:interview(?:ing)? process|hiring process|recruit(?:ment|ing) process|"
            r"selection process|application process|our process|the process|next steps|"
            r"how to apply|to apply|apply now|how we hire|what to expect|what happens next|"
            r"steps|timeline|"
            r"bewerbungsprozess|processus de recrutement|proceso de selecci[oó]n|"
            r"quy trình tuyển dụng|cách ứng tuyển)",
        ],
    ),
    (
        "compensation",
        [
            r"^" + _LEAD + r"(?:salary|salary range|pay|pay range|base pay|base salary|"
            r"compensation|total compensation|comp|remuneration|rate|hourly rate|budget|"
            r"wage|ote|on-target earnings|gehalt|salaire|r[eé]mun[eé]ration|salario|"
            r"mức lương|lương)\b.*",
            r".*\b(?:salary|compensation|pay ranges?|pay transparency range|base pay)\b.*",
        ],
    ),
    (
        "benefits",
        [
            r".*\b(?:benefits?|perks?|what we offer|what we'?re offering|we offer|"
            r"what'?s in it for you|in it for you|why (?:join|work)|why you'?ll love|"
            r"why us\b|reasons to join|what you(?:'ll)? get|you(?:'ll)? get|our offer|"
            r"what we provide|we provide|we give|rewards|total rewards|recognition|package|"
            r"life at|working (?:here|with us|at)|culture and benefits|take care of you|"
            r"supports? (?:you|our|full-time|employees)|growth (?:&|and) development|"
            r"what you can expect|why you should join|joining .+ means|"
            r"growth opportunit\w*|career (?:growth|development)|learning (?:&|and) development|"
            r"wir bieten|was wir bieten|unser angebot|deine vorteile|avantages|"
            r"ce que nous offrons|ofrecemos|beneficios|benefícios|oferecemos|"
            r"phúc lợi|quyền lợi|chế độ)",
        ],
    ),
    (
        "tech_stack",
        [
            r"^" + _LEAD + r"(?:tech(?:nology|nical)? stack|stack|tech|technologies|"
            r"technology|tools(?: (?:and|&) technologies)?|our stack|our tech|"
            r"tools we use|technologies we use|what we use|built with|công nghệ)\b.*",
        ],
    ),
    (
        "location_remote",
        [
            r"^" + _LEAD + r"(?:location|locations|work location|office location|"
            r"where you'?ll (?:work|be)|where|remote|remote work|remote policy|"
            r"work(?:ing)? (?:model|arrangement|hours|location|environment|schedule)|"
            r"hybrid|on-?site|time ?zones?|time zone requirements?|working hours|hours|"
            r"schedule|shift|travel|relocation|visa|work authori[sz]ation|headquarters|"
            r"arbeitsort|standort|lieu|ubicaci[oó]n|địa điểm|thời gian làm việc)\b.*",
        ],
    ),
    # Before responsibilities: "You'll thrive in this role if you have", "The essential
    # requirements of the job include" describe the candidate.
    (
        "requirements",
        [r".*\b(?:if you have|if you are|thrive|requirements? of)\b.*"],
    ),
    (
        "responsibilities",
        [
            r"^(?:you will|you'll|as (?:a|an|our) .+?,? you will|in this role,? you will)$",
            r".*\b(?:responsibilit|duties|accountabilit|what you'?ll (?:do|be doing|work on|"
            r"own|achieve|accomplish|tackle|build)|what you will (?:do|be doing|work on|own)|"
            r"what you'?d (?:do|be doing)|in this role|"
            r"difference you(?:'ll| will) make|"
            r"day[- ]to[- ]day|day in the life|your impact|impact you'?ll|the impact|"
            r"what's the job|what the job involves|your mission|the mission|mission|"
            r"your role|role responsibilities|key tasks|tasks|the work|the challenge|"
            r"what we need you to do|what you'?ll be responsible|you'?re responsible|"
            r"how you'?ll contribute|first (?:30|60|90|\d+) days|objectives?|outcomes|"
            r"a typical day|typical day|what success looks like|success looks like|"
            r"(?:key )?(?:areas of )?focus(?: areas)?|will do|will be doing|"
            r"dans ce r[oô]le|vous (?:allez|aurez)|"
            r"deine aufgaben|ihre aufgaben|aufgaben|vos missions|missions|tes missions|"
            r"responsabilidades|funciones|tus funciones|atividades|o que (?:você|voce|essa pessoa) "
            r"(?:irá|ira|vai) fazer|"
            r"mô tả công việc|trách nhiệm|nhiệm vụ)",
        ],
    ),
    (
        "requirements",
        [
            r".*\b(?:requirement|require|qualifications?|qualified|"
            r"what we value|exigences|"
            r"what you'?ll (?:bring|need|have)|what you (?:bring|need|have|offer)|"
            r"what we'?re looking for|what we look for|we'?re looking for|looking for|"
            r"who you are|about you|you are|you have|you bring|you might be|you may be|"
            r"must[- ]haves?|must have|need to have|essentials?|"
            r"what it takes|what makes you|ideal candidate|the candidate|candidate profile|"
            r"you'?d be a (?:great|good) fit|you(?:'re| are) a (?:great|good) fit|fit if|"
            r"is this you|sound like you|your profile|"
            r"dein profil|ihr profil|das bringst du mit|was du mitbringst|anforderungen|"
            r"votre profil|ton profil|profil recherch[eé]|requisitos|tu perfil|"
            r"yêu cầu|kỹ năng|kinh nghiệm)",
            # Topic words only as the heading's head noun ("Required Technical Skills",
            # "Education and Experience"), not inside a duty ("Customer Experience Programs").
            r"^(?:[\w-]+\s+){0,2}(?:skills?|experience|expertise|knowledge|education|"
            r"competenc\w*|background|profile|criteria)"
            r"(?:\s*(?:&|and|,|/)\s*(?:[\w-]+\s*){1,3})?$",
        ],
    ),
    (
        "about_role",
        [
            r".*\b(?:about the (?:role|job|position|opportunity|team|work)|the role|the position|"
            r"the opportunity|role overview|position overview|job overview|overview|"
            r"job summary|position summary|role summary|summary|job description|"
            r"description|the team|our team|your team|meet the team|team|about this role|"
            r"about this job|about this position|role description|introduction|"
            r"what is .+\?|the gig|opportunity|context|"
            r"über die rolle|die rolle|deine rolle|le poste|le r[oô]le|el puesto|a oportunidade|"
            r"a vaga|sobre a vaga|"
            r"sobre el puesto|vị trí|giới thiệu công việc)",
        ],
    ),
    (
        "about_company",
        [
            r"^(?:about|à propos de|über|acerca de|sobre|về)\b.*",
            r".*\b(?:who we are|about us|our company|the company|company overview|"
            r"company description|our story|our mission|our vision|our values|values|"
            r"our culture|culture|what we do|what we'?re building|we are|we'?re|"
            r"our principles|principles|community you(?:'ll| will) join|"
            r"why (?:we exist|now)|the product|our product|join us|who are we|"
            r"wer wir sind|über uns|qui sommes-nous|qui nous sommes|quiénes somos|"
            r"sobre nosotros|về chúng tôi|giới thiệu công ty)",
        ],
    ),
]

_COMPILED: list[tuple[str, list[re.Pattern[str]]]] = [
    (key, [re.compile(p, re.I) for p in patterns]) for key, patterns in _SYNONYMS
]

# "About you" / "About the role" are not about the company even though they start with "About".
_ABOUT_NOT_COMPANY = re.compile(
    r"^about (?:you|the (?:role|job|position|opportunity|team|work|internship)|"
    r"this (?:role|job|position|internship)|your)\b",
    re.I,
)

_BULLET = re.compile(r"^(?:- |\d{1,2}[.)] )")
_MD_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*$")
_MD_BOLD = re.compile(r"^(?:\*\*|__)(.+?)(?:\*\*|__):?$")
# "Salary: $120,000 - $150,000" / "Location: Remote (US)". The key part is checked against the
# table; only a few keys may carry their content inline (others are sentences with a colon).
_KEY_VALUE = re.compile(r"^([^:]{2,40}):\s+(\S.{0,300})$")
_INLINE_KEYS = {"compensation", "location_remote", "tech_stack"}
_EMOJI = re.compile(
    "[\U0001f300-\U0001faff\u2600-\u27bf\u2b00-\u2bff\ufe0f\u200d\u2190-\u21ff\u25a0-\u25ff]"
)
_SENTENCE_END = (".", "!", ";", ",")
MAX_HEADING_LEN = 80
MAX_HEADING_WORDS = 10
SUMMARY_MAX = 280


def normalise_heading(line: str) -> str:
    """ "**What You’ll Do:**" -> "what you'll do"."""
    text = line.strip()
    for pattern in (_MD_HEADING, _MD_BOLD):
        m = pattern.match(text)
        if m:
            text = m.group(1)
    text = _EMOJI.sub(" ", text).replace("’", "'").replace("‘", "'")
    text = re.sub(r"^[\s\-–—*•#|>]+|[\s:–—\-*•#|.!]+$", "", text)
    return re.sub(r"\s+", " ", text).lower()


def classify_heading(heading: str) -> str | None:
    """Canonical key for a heading, or None when the table does not know it."""
    text = normalise_heading(heading)
    if not text:
        return None
    if _ABOUT_NOT_COMPANY.match(text):
        if re.match(r"^about (?:you|your)\b", text):
            return "requirements"
        return "about_role"
    for key, patterns in _COMPILED:
        if any(p.match(text) for p in patterns):
            return key
    return None


def _words(text: str) -> int:
    return len(text.split())


def _is_all_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 3 and all(c.isupper() for c in letters)


def _looks_like_words(text: str) -> bool:
    """Not a code or a stray marker ("p78877", "*required", "us")."""
    letters = sum(c.isalpha() for c in text)
    return letters >= 4 and not re.fullmatch(r"[a-z]{0,3}\d[\w-]*", text) and text[0].isalpha()


def _is_title_case(text: str) -> bool:
    words = [w for w in re.findall(r"[^\W\d_][\w'’-]*", text)]
    if not words:
        return False
    small = {
        "a",
        "an",
        "and",
        "or",
        "the",
        "of",
        "to",
        "in",
        "for",
        "on",
        "at",
        "with",
        "you",
        "we",
    }
    return all(w[0].isupper() or w.lower() in small for w in words) and words[0][0].isupper()


def _heading_shape(line: str) -> tuple[bool, bool]:
    """(could be a heading, is explicitly marked as one: markdown / ALL CAPS / ends with ':')."""
    text = line.strip()
    if not text or _BULLET.match(text) or re.match(r"^[-*+]\w", text):
        return False, False
    marked = bool(_MD_HEADING.match(text) or _MD_BOLD.match(text))
    core = normalise_heading(text)
    if not core or len(text) > MAX_HEADING_LEN or _words(core) > MAX_HEADING_WORDS:
        return False, False
    if text.endswith(_SENTENCE_END) and not marked:
        return False, False
    if re.search(r"https?://|@\w", text):
        return False, False
    explicit = marked or _is_all_caps(core) or text.endswith(":")
    return True, explicit


def _summary(body: str) -> str:
    """The section's first few points, in order: list items count one each, paragraphs split
    into sentences; sub-headings and "…:" lead-ins are skipped."""
    items: list[str] = []
    bullets = False
    for raw_line in body.split("\n"):
        line = raw_line.strip()
        if not line or line.endswith(":"):
            continue
        if _BULLET.match(line):
            bullets = bullets or not items
            items.append(_BULLET.sub("", line).rstrip(".;, "))
        elif len(line) <= 60 and not line.endswith((".", "!", "?")):
            continue  # a sub-heading ("TECHNICAL EVANGELISM & EDUCATION")
        else:
            items.extend(
                s.rstrip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])", line) if s.strip()
            )
        if len(items) >= 3:
            break
    if not items:
        items = [body]
    text = "; ".join(items[:3]) if bullets else " ".join(items[:2])
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > SUMMARY_MAX:
        cut = text[: SUMMARY_MAX - 1]
        text = (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(",;:- ") + "…"
    return text


def _next_content(lines: list[str], i: int) -> str | None:
    for nxt in lines[i + 1 :]:
        if nxt.strip():
            return nxt.strip()
    return None


def parse_sections(description: str | None) -> list[dict[str, Any]] | None:
    """Sections of a description in posting order, or None for an empty description."""
    if not description or not description.strip():
        return None
    lines = description.split("\n")
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] = {"key": "intro", "heading": None, "lines": []}

    def flush() -> None:
        body = "\n".join(current["lines"]).strip()
        if body or current["heading"]:
            sections.append({"key": current["key"], "heading": current["heading"], "body": body})

    for i, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            current["lines"].append("")
            continue

        # "Salary: $120k" / "Location: Remote": a one-line section.
        kv = _KEY_VALUE.match(line)
        if kv and not _BULLET.match(line):
            key = classify_heading(kv.group(1))
            if key in _INLINE_KEYS and _words(kv.group(1)) <= 4:
                flush()
                sections.append({"key": key, "heading": kv.group(1).strip(), "body": kv.group(2)})
                current = {"key": current["key"], "heading": None, "lines": []}
                continue

        shape, explicit = _heading_shape(line)
        if shape:
            key = classify_heading(line)
            nxt = _next_content(lines, i)
            if nxt is None:
                key = None  # a short last line is a sign-off, not a heading
            elif key is None:
                # An unknown short line is a heading only when it is marked as one and something
                # follows it ("Our Engineering Principles:" + bullets); otherwise it is text.
                # Inside a recognised section, a title-case or "…:" line is a sub-heading of it
                # ("General ledger, AP & AR" under "Responsibilities") and stays in its body;
                # only ALL CAPS / markdown headings start an `other` section there.
                core = normalise_heading(line)
                marked = bool(_MD_HEADING.match(line) or _MD_BOLD.match(line))
                strong = explicit or (_is_title_case(line) and _BULLET.match(nxt) is not None)
                if current["key"] not in ("intro", "other") and not (marked or _is_all_caps(core)):
                    strong = False
                if strong and not line.endswith("?") and _looks_like_words(core):
                    key = "other"
            elif not (explicit or _is_title_case(line) or line.endswith("?")) and len(line) > 50:
                # A long, unmarked sentence-case line that merely contains a heading word
                # ("Requirements…") is text, not a heading.
                key = None
            if key is not None:
                flush()
                heading = _MD_BOLD.sub(r"\1", _MD_HEADING.sub(r"\1", line)).strip()
                current = {"key": key, "heading": heading.rstrip(":").strip(), "lines": []}
                continue
        current["lines"].append(line)
    flush()

    # A heading-only section (no body) takes in the section after it, whose heading is then a
    # sub-heading: "Requirements" + "Must have:", "WHAT YOU'LL DO" + "In this role, you'll:".
    merged: list[dict[str, Any]] = []
    for section in sections:
        prev = merged[-1] if merged else None
        if section["heading"] is None and section["key"] != "intro":
            # Text that went on after a one-line "Salary: …" section: back to its section.
            owner = next((s for s in reversed(merged) if s["key"] == section["key"]), None)
            if owner is not None:
                owner["body"] = f"{owner['body']}\n{section['body']}".strip()
                continue
        if prev is not None and not prev["body"]:
            if section["heading"]:
                # Keep the second heading as the body's lead-in line ("In this role, you'll:").
                section = {**section, "body": f"{section['heading']}:\n{section['body']}".strip()}
            merged[-1] = {**prev, "body": section["body"]}
            continue
        merged.append(section)

    out = []
    for section in merged:
        body = re.sub(r"\n{3,}", "\n\n", section["body"]).strip()
        if not body:
            continue
        out.append(
            {
                "key": section["key"],
                "heading": section["heading"],
                "body": body,
                "summary": _summary(body),
            }
        )
    return out or None


def recognised(sections: list[dict[str, Any]] | None) -> int:
    """How many sections have a canonical key (not `intro` / `other`)."""
    return sum(1 for s in sections or [] if s["key"] not in ("intro", "other"))
