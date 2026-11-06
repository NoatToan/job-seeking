"""Feeds the blog cites or republishes. Only public RSS/Atom feeds the publisher offers.

Two modes per source (docs/DECISIONS.md "Blog"):

- `excerpt` (the default, most news and company blogs): we keep title, link, author, date and an
  excerpt of at most 50 words from the feed's own summary, and always link to the original. The
  article body is never stored, even when the feed carries it.
- `full`: only for sources whose licence allows republication, with the licence URL recorded
  here after checking it: US federal government works (public domain), Creative Commons
  CC BY / CC BY-SA / CC BY-ND (verbatim only), or an explicit republishing policy. We store the
  feed's full text as a sanitised block document (no raw HTML, no images) and render it with
  attribution and a canonical link to the original.

To add a source: append a `FeedSource` below (leave `republish_mode="excerpt"` unless you have
read the licence and put its URL in `licence_url`), save a trimmed copy of its feed under
`tests/fixtures/blog/` with a parser test, then run
`uv run python -m job_crawler.blog --dry-run --source <key>` to check robots.txt and item counts.
"""

from dataclasses import dataclass
from typing import Literal

RepublishMode = Literal["full", "excerpt"]

CONVERSATION_LICENCE = "CC BY-ND 4.0"
CONVERSATION_LICENCE_URL = "https://creativecommons.org/licenses/by-nd/4.0/"
CONVERSATION_POLICY_URL = "https://theconversation.com/republishing-guidelines"
# The Conversation's republishing rules require their 1x1 page-view counter on republished pages.
CONVERSATION_PIXEL = r"^https://counter\.theconversation\.com/content/\d+/count\.gif$"


@dataclass(frozen=True)
class FeedSource:
    key: str  # stable id, stored in blog_articles.source
    name: str  # shown in the attribution line ("Read the original on <name>")
    homepage: str
    feed_url: str
    # Article links must be on one of these hosts (or a subdomain); anything else is dropped, so a
    # compromised or odd feed can't make us link somewhere unexpected.
    hosts: tuple[str, ...]
    # Topics an item gets when none of the keyword rules in topics.py match it.
    default_topics: tuple[str, ...]
    republish_mode: RepublishMode = "excerpt"
    licence_name: str | None = None  # e.g. "CC BY 4.0", "Public domain (US government work)"
    licence_url: str | None = None  # the licence text, or the publisher's page granting it
    policy_url: str | None = None  # publisher's republishing guidelines, when separate
    # Full mode: when set, an item's own <rights> must match this (case-insensitive) or the item
    # falls back to excerpt mode, so one differently-licensed item is never republished.
    item_rights_pattern: str | None = None
    # Full mode: a tracking pixel the licence requires us to keep (matched against <img src>).
    pixel_pattern: str | None = None
    # Broad feeds: keep only items whose title matches one of these topics' keywords, so
    # the blog stays on hiring / careers / the job market. Empty = keep every item.
    require_topics: tuple[str, ...] = ()
    # Newest items taken from the feed per run (full-mode sources republish selectively, never a
    # publisher's whole output).
    max_items_per_run: int = 25
    # Items published longer ago than this are ignored (a first run would otherwise backfill a
    # year of monthly releases). Full-text sources look further back so the blog starts with some
    # on-site reading; max_items_per_run still bounds how many are taken.
    max_age_days: int = 30
    # Max items from this source per roundup, so one prolific feed can't fill a post.
    per_roundup_cap: int = 4
    notes: str = ""

    def __post_init__(self) -> None:
        if self.republish_mode == "full" and not (self.licence_name and self.licence_url):
            raise ValueError(f"{self.key}: full republication needs licence_name and licence_url")


def _conversation(slug: str, topic_name: str, topics: tuple[str, ...]) -> FeedSource:
    return FeedSource(
        key=f"conversation-{slug.rsplit('-', 1)[0]}",
        name="The Conversation",
        homepage=f"https://theconversation.com/topics/{slug}",
        feed_url=f"https://theconversation.com/topics/{slug}/articles.atom",
        hosts=("theconversation.com",),
        default_topics=topics,
        republish_mode="full",
        licence_name=CONVERSATION_LICENCE,
        licence_url=CONVERSATION_LICENCE_URL,
        policy_url=CONVERSATION_POLICY_URL,
        item_rights_pattern=r"creative commons",
        pixel_pattern=CONVERSATION_PIXEL,
        max_items_per_run=3,
        max_age_days=120,
        per_roundup_cap=2,
        notes=f"Academic news site, '{topic_name}' topic feed. Republishing allowed verbatim under"
        " CC BY-ND 4.0 with author + institution credit, a link back and their page counter; not"
        " 'systematically all' articles, hence a few topic feeds and 3 items per feed per run.",
    )


SOURCES: tuple[FeedSource, ...] = (
    # --- Full text (licence verified) -----------------------------------------------------------
    FeedSource(
        key="bls-employment-situation",
        name="U.S. Bureau of Labor Statistics",
        homepage="https://www.bls.gov/ces/",
        feed_url="https://www.bls.gov/feed/empsit.rss",
        hosts=("bls.gov",),
        default_topics=("labour-market",),
        republish_mode="full",
        licence_name="Public domain (U.S. government work)",
        licence_url="https://www.bls.gov/opub/copyright-information.htm",
        max_age_days=60,  # monthly releases
        per_roundup_cap=2,
        notes="Monthly US jobs report summary.",
    ),
    FeedSource(
        key="bls-jolts",
        name="U.S. Bureau of Labor Statistics",
        homepage="https://www.bls.gov/jlt/",
        feed_url="https://www.bls.gov/feed/jolts.rss",
        hosts=("bls.gov",),
        default_topics=("labour-market", "hiring"),
        republish_mode="full",
        licence_name="Public domain (U.S. government work)",
        licence_url="https://www.bls.gov/opub/copyright-information.htm",
        max_age_days=60,  # monthly releases
        per_roundup_cap=2,
        notes="Job openings, hires and quits (JOLTS) summary.",
    ),
    _conversation("labour-market-2562", "Labour market", ("labour-market",)),
    _conversation("employment-700", "Employment", ("labour-market", "careers")),
    _conversation("future-of-work-3473", "Future of work", ("tech-industry", "careers")),
    _conversation("remote-work-35265", "Remote work", ("remote-work",)),
    _conversation("careers-7088", "Careers", ("careers",)),
    _conversation("layoffs-55818", "Layoffs", ("tech-industry",)),
    FeedSource(
        key="lse-business-review",
        name="LSE Business Review",
        homepage="https://blogs.lse.ac.uk/businessreview/",
        feed_url="https://blogs.lse.ac.uk/businessreview/feed/",
        hosts=("blogs.lse.ac.uk",),
        default_topics=("careers",),
        republish_mode="full",
        licence_name="CC BY 4.0",
        licence_url="https://creativecommons.org/licenses/by/4.0/",
        policy_url="https://blogs.lse.ac.uk/republishing-policy/",
        require_topics=("hiring", "careers", "labour-market", "remote-work"),
        max_items_per_run=5,
        max_age_days=120,
        per_roundup_cap=2,
        notes="LSE Blogs republishing policy: CC BY 4.0, credit title + author + 'originally"
        " published on LSE Blogs' + link. Images are excluded (separate terms).",
    ),
    # --- Excerpt only (copyright reserved) ------------------------------------------------------
    FeedSource(
        key="indeed-hiring-lab",
        name="Indeed Hiring Lab",
        homepage="https://www.hiringlab.org/",
        feed_url="https://www.hiringlab.org/feed/",
        hosts=("hiringlab.org", "hiringlab.indeed.com"),
        default_topics=("labour-market", "hiring"),
        notes="Indeed's economic research team: job postings, wages, hiring demand.",
    ),
    FeedSource(
        key="hr-dive-talent",
        name="HR Dive",
        homepage="https://www.hrdive.com/topic/talent/",
        feed_url="https://www.hrdive.com/feeds/topic/talent/",
        hosts=("hrdive.com",),
        default_topics=("hiring",),
        notes="Industry Dive's HR newsroom, talent / recruiting topic feed.",
    ),
    FeedSource(
        key="ere",
        name="ERE",
        homepage="https://www.ere.net/",
        feed_url="https://www.ere.net/feed/",
        hosts=("ere.net",),
        default_topics=("hiring",),
        notes="Recruiting and talent-acquisition news and commentary.",
    ),
    FeedSource(
        key="pragmatic-engineer",
        name="The Pragmatic Engineer",
        homepage="https://newsletter.pragmaticengineer.com/",
        feed_url="https://newsletter.pragmaticengineer.com/feed",
        hosts=("newsletter.pragmaticengineer.com", "pragmaticengineer.com"),
        default_topics=("tech-industry", "careers"),
        per_roundup_cap=3,
        notes="Tech industry and engineering careers. Partly paywalled: we only use the feed's"
        " public subtitle, never the post body.",
    ),
    FeedSource(
        key="stack-overflow-blog",
        name="Stack Overflow Blog",
        homepage="https://stackoverflow.blog/",
        feed_url="https://stackoverflow.blog/feed/",
        hosts=("stackoverflow.blog",),
        default_topics=("tech-industry",),
        require_topics=("hiring", "careers", "labour-market", "remote-work"),
        per_roundup_cap=2,
        notes="Developer careers and industry; filtered to on-topic items (it's mostly technical).",
    ),
    FeedSource(
        key="techcrunch-layoffs",
        name="TechCrunch",
        homepage="https://techcrunch.com/tag/layoffs/",
        feed_url="https://techcrunch.com/tag/layoffs/feed/",
        hosts=("techcrunch.com",),
        default_topics=("tech-industry",),
        per_roundup_cap=3,
        notes="Tech layoffs tag: hiring freezes and cuts are a core industry-trend signal.",
    ),
    FeedSource(
        key="remotive-blog",
        name="Remotive",
        homepage="https://remotive.com/blog",
        feed_url="https://remotive.com/blog/feed",
        hosts=("remotive.com",),
        default_topics=("remote-work", "careers"),
        per_roundup_cap=2,
        notes="Remote job board's blog and newsletter: remote work and job-search trends.",
    ),
)

SOURCES_BY_KEY: dict[str, FeedSource] = {s.key: s for s in SOURCES}
