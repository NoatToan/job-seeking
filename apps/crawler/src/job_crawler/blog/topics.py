"""Blog topics: keyword rules that tag referenced articles, plus the job searches each topic links
to (that's how a blog visitor reaches the job catalogue).

The slugs are part of public URLs (`/blog/topics/<slug>/`) and are mirrored in
`apps/web/src/lib/blog/topics.ts`; change both together.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Topic:
    slug: str
    name: str
    keywords: tuple[str, ...]  # regex fragments, matched case-insensitively on word boundaries
    # Related jobs for a roundup: Postgres `websearch_to_tsquery` text over jobs.search, or None
    # for "any recent job" (with remote_only when set).
    job_query: str | None
    remote_only: bool = False


TOPICS: tuple[Topic, ...] = (
    Topic(
        slug="hiring",
        name="Hiring & recruitment",
        keywords=(
            r"hir(e|es|ed|ing)",
            r"recruit\w*",
            r"talent acquisition",
            r"interview\w*",
            r"candidates?",
            r"applicants?",
            r"job offers?",
            r"onboarding",
            r"sourcing",
            r"headcount",
            r"job openings?",
        ),
        job_query='recruiter OR "talent acquisition" OR sourcer OR "people partner"',
    ),
    Topic(
        slug="labour-market",
        name="Labour market & jobs data",
        keywords=(
            r"jobs report",
            r"payrolls?",
            r"unemployment",
            r"labou?r market",
            r"jolts",
            r"quits",
            r"wages?",
            r"employment cost",
            r"job market",
            r"productivity",
            r"labou?r force",
        ),
        job_query='"data analyst" OR economist OR "research analyst"',
    ),
    Topic(
        slug="careers",
        name="Careers & skills",
        keywords=(
            r"careers?",
            r"promotions?",
            r"r[ée]sum[ée]s?",
            r"salar(y|ies)",
            r"skills?",
            r"job seekers?",
            r"job search",
            r"burnout",
            r"engineering manag\w+",
            r"mentor\w*",
            r"upskill\w*",
            r"quit(s|ting)?",
        ),
        job_query='"engineering manager" OR "staff engineer" OR "tech lead" OR "senior engineer"',
    ),
    Topic(
        slug="remote-work",
        name="Remote & hybrid work",
        keywords=(
            r"remote",
            r"hybrid",
            r"return[- ]to[- ](the )?office",
            r"rto",
            r"work from home",
            r"wfh",
            r"distributed teams?",
            r"four[- ]day week",
            r"office",
        ),
        job_query=None,
        remote_only=True,
    ),
    Topic(
        slug="tech-industry",
        name="Tech industry trends",
        keywords=(
            r"lay(s)? off",
            r"layoffs?",
            r"laid off",
            r"job cuts?",
            r"cuts? (staff|jobs)",
            r"ai",
            r"artificial intelligence",
            r"agents?",
            r"startups?",
            r"software engineering",
            r"developers?",
        ),
        job_query='"software engineer" OR "machine learning" OR "AI engineer" OR developer',
    ),
)

TOPICS_BY_SLUG: dict[str, Topic] = {t.slug: t for t in TOPICS}

_PATTERNS: dict[str, re.Pattern[str]] = {
    t.slug: re.compile(r"\b(?:" + "|".join(t.keywords) + r")\b", re.IGNORECASE) for t in TOPICS
}


def classify(text: str, *, max_topics: int = 2) -> list[str]:
    """Topic slugs whose keywords occur in `text`, most matches first (ties keep TOPICS order)."""
    scores = []
    for index, topic in enumerate(TOPICS):
        hits = len(_PATTERNS[topic.slug].findall(text))
        if hits:
            scores.append((-hits, index, topic.slug))
    return [slug for _, _, slug in sorted(scores)[:max_topics]]
