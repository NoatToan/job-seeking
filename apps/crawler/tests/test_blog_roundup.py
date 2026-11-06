"""Roundup selection and templated text, plus source-registry invariants."""

import re
from datetime import UTC, datetime, timedelta

from job_crawler.blog.feeds import Article
from job_crawler.blog.roundup import DESCRIPTION_MAX, build, clip, group, select_articles
from job_crawler.blog.sources import SOURCES, SOURCES_BY_KEY
from job_crawler.blog.topics import TOPICS, TOPICS_BY_SLUG, classify

NOW = datetime(2026, 11, 6, 22, 0, tzinfo=UTC)


def art(i: int, source: str, topics: list[str], *, full: bool = False) -> Article:
    return Article(
        source=source,
        source_name=SOURCES_BY_KEY[source].name if source in SOURCES_BY_KEY else source,
        external_id=str(i),
        url=f"https://x.test/{i}",
        title=f"Article {i}",
        excerpt="Short excerpt.",
        published_at=NOW - timedelta(hours=i),
        topics=topics,
        republish_mode="full" if full else "excerpt",
    )


def test_select_caps_per_source_and_needs_minimum():
    many = [art(i, "hr-dive-talent", ["hiring"]) for i in range(10)]
    cap = SOURCES_BY_KEY["hr-dive-talent"].per_roundup_cap
    assert select_articles(many, min_items=1) == many[:cap]
    assert select_articles(many, min_items=cap + 1) == []
    mixed = many + [art(100 + i, "ere", ["hiring"]) for i in range(10)]
    assert len(select_articles(mixed, min_items=1, max_items=5)) == 5


def test_group_by_primary_topic_in_topic_order_newest_first():
    articles = [
        art(3, "ere", ["tech-industry"]),
        art(1, "ere", ["hiring", "careers"]),
        art(2, "hr-dive-talent", ["hiring"]),
        art(4, "ere", ["unknown-topic"]),
    ]
    sections = group(articles)
    assert [s.topic for s in sections] == ["hiring", "tech-industry"]
    assert [a.title for a in sections[0].articles] == ["Article 1", "Article 2"]
    assert [a.title for a in sections[1].articles] == ["Article 3", "Article 4"]


def test_build_post_text_names_every_publisher_and_full_text_count():
    articles = [
        art(1, "ere", ["hiring"]),
        art(2, "bls-jolts", ["labour-market"], full=True),
        art(3, "techcrunch-layoffs", ["tech-industry"]),
    ]
    post = build(articles, now=NOW)
    assert post.slug == "hiring-career-trends-2026-11-06"
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", post.slug)
    assert post.title == "Hiring & career trends roundup — 6 November 2026"
    for name in ("ERE", "U.S. Bureau of Labor Statistics", "TechCrunch"):
        assert name in post.intro
    assert "1 of the articles are published under open licences" in post.intro
    assert len(post.description) <= DESCRIPTION_MAX
    assert post.topics == ["hiring", "labour-market", "tech-industry"]
    assert len(post.items()) == 3
    labour = next(s for s in post.sections if s.topic == "labour-market")
    assert "republished in full" in labour.commentary


def test_clip():
    assert clip("a  b", 10) == "a b"
    assert clip("one two three four", 10) == "one two…"


def test_classify():
    assert classify("Canva lays off 1,200 staff")[0] == "tech-industry"
    assert classify("September JOLTS: quits increase, job openings flat")[0] == "labour-market"
    assert "careers" not in classify("Why your sandbox never quite matches production")
    assert classify("Nothing relevant here") == []


def test_source_registry_invariants():
    keys = [s.key for s in SOURCES]
    assert len(keys) == len(set(keys))
    for s in SOURCES:
        assert set(s.default_topics) <= set(TOPICS_BY_SLUG)
        assert set(s.require_topics) <= set(TOPICS_BY_SLUG)
        assert s.feed_url.startswith("https://")
        if s.republish_mode == "full":
            assert s.licence_name and s.licence_url and s.licence_url.startswith("https://")
        else:
            assert s.pixel_pattern is None and s.item_rights_pattern is None
    assert any(s.republish_mode == "full" for s in SOURCES)
    assert any(s.republish_mode == "excerpt" for s in SOURCES)
    assert [t.slug for t in TOPICS] == [
        "hiring",
        "labour-market",
        "careers",
        "remote-work",
        "tech-industry",
    ]
