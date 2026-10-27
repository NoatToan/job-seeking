"""Cheap keyword scoring to pick which jobs are worth a Claude review (from the jobflow POC)."""

import re
from typing import Any, Protocol

_TOKEN = re.compile(r"[a-z0-9+#.]+")
_GENERIC = {
    "engineer", "developer", "software", "senior", "junior", "lead", "staff", "principal",
    "mid", "level", "remote", "the", "and", "of", "for", "sr", "jr", "ii", "iii",
}  # fmt: skip
_SENIOR_WORDS = {"senior", "sr", "lead", "principal", "staff", "head", "director", "architect"}
_JUNIOR_WORDS = {"junior", "jr", "intern", "internship", "graduate", "entry"}
_SENIOR_LEVELS = {"senior", "lead", "principal", "manager"}
_JUNIOR_LEVELS = {"intern", "junior"}


class JobLike(Protocol):
    title: str
    tags: list[str]
    description: str


def _tokens(s: str) -> list[str]:
    return _TOKEN.findall(s.lower())


def _has(hay: str, term: str) -> bool:
    """Whole-term match that also works for 'c++', 'c#', 'node.js'."""
    t = term.lower().strip()
    if not t:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", hay) is not None


def score(profile: dict[str, Any], job: JobLike) -> float:
    title = job.title.lower()
    head = f"{title} {' '.join(job.tags).lower()}"
    body = (job.description or "").lower()
    total = 0.0

    for i, skill in enumerate(profile.get("skills") or []):
        weight = 1.0 if i < 10 else 0.5
        if _has(head, skill):
            total += 2 * weight
        elif _has(body, skill):
            total += weight

    title_tokens = set(_tokens(title))
    for target in profile.get("target_titles") or []:
        core = [t for t in _tokens(target) if t not in _GENERIC]
        if core and all(t in title_tokens for t in core):
            total += 5
            break
        total += sum(1.5 for t in core if t in title_tokens)

    for kw in profile.get("search_keywords") or []:
        if _has(head, kw):
            total += 1.5

    level = (profile.get("seniority") or "").lower()
    if level in _JUNIOR_LEVELS and title_tokens & _SENIOR_WORDS:
        total -= 4
    if level in _SENIOR_LEVELS and title_tokens & _JUNIOR_WORDS:
        total -= 4
    return round(total, 2)


def top_candidates[J: JobLike](
    profile: dict[str, Any], jobs: list[J], limit: int, min_score: float = 2.0
) -> list[tuple[J, float]]:
    scored = [(j, score(profile, j)) for j in jobs]
    scored = [x for x in scored if x[1] >= min_score]
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]
