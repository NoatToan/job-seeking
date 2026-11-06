"""Build a daily "Hiring & career trends" roundup post from articles not yet cited.

The post is our own page (no LLM, templated text): an intro, per-topic sections listing the cited
articles with attribution (linking to our full-text copy when the licence allowed republishing,
and always to the original), and a snapshot of related jobs from our catalogue.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from job_crawler.blog.feeds import Article
from job_crawler.blog.sources import SOURCES_BY_KEY
from job_crawler.blog.topics import TOPICS, TOPICS_BY_SLUG

DESCRIPTION_MAX = 160


@dataclass
class RoundupSection:
    topic: str
    commentary: str
    articles: list[Article] = field(default_factory=list)


@dataclass
class Roundup:
    slug: str
    title: str
    description: str
    intro: str
    sections: list[RoundupSection]
    published_at: datetime
    related_jobs: list[dict[str, Any]] = field(default_factory=list)

    @property
    def topics(self) -> list[str]:
        return [s.topic for s in self.sections]

    def items(self) -> list[tuple[RoundupSection, Article]]:
        return [(s, a) for s in self.sections for a in s.articles]

    @property
    def articles(self) -> list[Article]:
        return [a for _, a in self.items()]


def clip(text: str, limit: int) -> str:
    """Collapse whitespace and clip to `limit` characters on a word boundary."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    return (cut[: cut.rfind(" ")] if " " in cut else cut).rstrip(",;:.—–- ") + "…"


def select_articles(
    candidates: list[Article], *, min_items: int = 5, max_items: int = 24
) -> list[Article]:
    """Newest first, at most `per_roundup_cap` per source and `max_items` overall. Returns [] when
    fewer than `min_items` qualify (a thin post isn't worth publishing; they roll over)."""
    per_source: Counter[str] = Counter()
    picked: list[Article] = []
    for article in candidates:
        source = SOURCES_BY_KEY.get(article.source)
        cap = source.per_roundup_cap if source else 2
        if per_source[article.source] >= cap:
            continue
        per_source[article.source] += 1
        picked.append(article)
        if len(picked) >= max_items:
            break
    return picked if len(picked) >= min_items else []


def join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _when(article: Article) -> float:
    return article.published_at.timestamp() if article.published_at else 0.0


def group(articles: list[Article]) -> list[RoundupSection]:
    """One section per primary topic, in TOPICS order; articles newest first within a section."""
    by_topic: dict[str, list[Article]] = {}
    for article in articles:
        topic = next((t for t in article.topics if t in TOPICS_BY_SLUG), "tech-industry")
        by_topic.setdefault(topic, []).append(article)
    sections = []
    for topic in TOPICS:
        items = sorted(by_topic.get(topic.slug, []), key=_when, reverse=True)
        if not items:
            continue
        names = list(dict.fromkeys(a.source_name for a in items))
        noun = "article" if len(items) == 1 else "articles"
        full = sum(a.republish_mode == "full" for a in items)
        commentary = f"{len(items)} {noun} on {topic.name.lower()}, from {join(names)}."
        if full:
            commentary += (
                f" {full} of them {'is' if full == 1 else 'are'} republished in full on this site"
                " under the publisher's open licence."
            )
        sections.append(RoundupSection(topic=topic.slug, commentary=commentary, articles=items))
    return sections


def slug_for(day: datetime) -> str:
    return f"hiring-career-trends-{day:%Y-%m-%d}"


def human_date(day: datetime) -> str:
    return f"{day.day} {day:%B %Y}"


def build(articles: list[Article], *, now: datetime) -> Roundup:
    """The roundup post for `articles` (already selected), dated `now`."""
    sections = group(articles)
    sources = list(dict.fromkeys(a.source_name for a in articles))
    ranked = sorted(sections, key=lambda s: -len(s.articles))
    themes = [TOPICS_BY_SLUG[s.topic].name.lower() for s in ranked]
    full = sum(a.republish_mode == "full" for a in articles)
    lead = max(articles, key=_when)
    intro = (
        f"This roundup collects {len(articles)} recent articles on hiring, the job market and tech"
        f" careers from {len(sources)} publishers: {join(sources)}. The biggest theme this time"
        f" is {themes[0]}"
        + (f", followed by {join(themes[1:])}." if len(themes) > 1 else ".")
        + f' The most recent is "{lead.title}" from {lead.source_name}.'
        + "\n\n"
        + (
            f"{full} of the articles are published under open licences and can be read in full"
            " here, with credit to their authors; for the rest we show the publisher's own short"
            " summary and link to the original. "
            if full
            else "For each article we show the publisher's own short summary and link to the"
            " original. "
        )
        + "Below the list you'll find open roles from our job catalogue related to these topics."
    )
    description = f"{len(articles)} articles on {join(themes[:2])}, from {join(sources[:2])}" + (
        " and others" if len(sources) > 2 else ""
    )
    if len(description) > DESCRIPTION_MAX - 20:
        description = f"{len(articles)} articles on {join(themes[:2])}"
    description = clip(description + ", plus related jobs.", DESCRIPTION_MAX)
    return Roundup(
        slug=slug_for(now),
        title=f"Hiring & career trends roundup — {human_date(now)}",
        description=description,
        intro=intro,
        sections=sections,
        published_at=now,
    )
