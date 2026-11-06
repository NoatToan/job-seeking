"""Description sections (job_crawler.sections) on real postings from every source
(tests/fixtures/jd_sample.json, sampled from the public API) plus hand-written edge cases."""

import json
from pathlib import Path

import pytest

from job_crawler import derived
from job_crawler.sections import (
    SECTION_KEYS,
    SUMMARY_MAX,
    classify_heading,
    parse_sections,
    recognised,
)

FIXTURE = Path(__file__).parent / "fixtures" / "jd_sample.json"
JOBS = json.loads(FIXTURE.read_text())["jobs"]
BY_ID = {j["id"]: j for j in JOBS}
# A full posting (not a 150-character teaser or a truncated feed summary).
FULL = [j for j in JOBS if len(j["description"] or "") >= 800]


def keys(job_id: str) -> list[str]:
    return [s["key"] for s in parse_sections(BY_ID[job_id]["description"]) or []]


# One posting per source, checked section by section (posting order).
@pytest.mark.parametrize(
    ("job_id", "expected"),
    [
        # Greenhouse (Airbnb style): Title Case headings, several pay/EEO blocks.
        (
            "6253",
            [
                "intro",
                "about_company",
                "responsibilities",
                "responsibilities",
                "requirements",
                "location_remote",
                "equal_opportunity",
                "equal_opportunity",
                "benefits",
                "compensation",
            ],
        ),
        # Lever (Palantir): description + `lists` blocks ("What We Value", "What We Require").
        (
            "1668",
            [
                "intro",
                "about_role",
                "responsibilities",
                "requirements",
                "requirements",
                "compensation",
                "benefits",
                "benefits",
            ],
        ),
        # Ashby (PostHog): ALL CAPS headings.
        (
            "1881",
            [
                "about_company",
                "about_company",
                "requirements",
                "responsibilities",
                "requirements",
            ],
        ),
        # Himalayas: plain HTML headings.
        (
            "14016",
            ["about_company", "responsibilities", "requirements", "nice_to_have", "benefits"],
        ),
        # Himalayas, Portuguese headings ("A Oportunidade", "O que oferecemos").
        ("13997", ["intro", "about_role", "nice_to_have", "benefits"]),
        # We Work Remotely: the "Headquarters: …" line, then the posting.
        (
            "6128",
            [
                "location_remote",
                "about_company",
                "about_role",
                "responsibilities",
                "responsibilities",
                "requirements",
                "nice_to_have",
                "hiring_process",
            ],
        ),
        # Remotive.
        (
            "5137",
            [
                "intro",
                "about_role",
                "responsibilities",
                "requirements",
                "compensation",
                "hiring_process",
            ],
        ),
        # SEEK sends a teaser only: one intro section, nothing recognised.
        ("8664", ["intro"]),
        # Arc / LinkedIn rows have no description at all.
        ("5190", []),
        ("2453", []),
    ],
)
def test_sections_per_source(job_id, expected):
    assert keys(job_id) == expected


def test_full_postings_have_at_least_two_recognised_sections():
    hits = [j["id"] for j in FULL if recognised(parse_sections(j["description"])) >= 2]
    # Measured on 256 sampled full postings: 97.7%. The fixture keeps the bar high.
    assert len(hits) / len(FULL) >= 0.95, sorted(set(j["id"] for j in FULL) - set(hits))


@pytest.mark.parametrize("job", FULL, ids=lambda j: f"{j['source']}-{j['id']}")
def test_no_text_is_lost(job):
    """Every line of the description is in some section's heading or body."""
    sections = parse_sections(job["description"])
    covered = "\n".join(f"{s['heading'] or ''}\n{s['body']}" for s in sections)
    for line in job["description"].split("\n"):
        line = line.strip()
        if not line:
            continue
        key, _, value = line.partition(": ")
        assert line.rstrip(":").strip() in covered or (
            value and key.strip() in covered and value.strip() in covered
        ), line


@pytest.mark.parametrize("job", FULL, ids=lambda j: f"{j['source']}-{j['id']}")
def test_section_shape(job):
    for section in parse_sections(job["description"]):
        assert section["key"] in SECTION_KEYS
        assert section["body"]
        assert 0 < len(section["summary"]) <= SUMMARY_MAX
        assert (section["heading"] is None) == (section["key"] == "intro")


@pytest.mark.parametrize(
    ("heading", "key"),
    [
        ("About us", "about_company"),
        ("ABOUT SUPABASE", "about_company"),
        ("Who we are", "about_company"),
        ("About the role", "about_role"),
        ("The Opportunity", "about_role"),
        ("About the team", "about_role"),
        ("What you’ll do:", "responsibilities"),
        ("**Key Responsibilities**", "responsibilities"),
        ("A Typical Day", "responsibilities"),
        ("Your impact", "responsibilities"),
        ("Requirements", "requirements"),
        ("What you'll bring", "requirements"),
        ("Who you are", "requirements"),
        ("About you", "requirements"),
        ("Must have", "requirements"),
        ("You'll thrive in this role if you have:", "requirements"),
        ("Nice to have", "nice_to_have"),
        ("Bonus points", "nice_to_have"),
        ("Preferred qualifications", "nice_to_have"),
        ("Annual base salary range (excluding bonus)", "compensation"),
        ("Salary", "compensation"),
        ("Pay range", "compensation"),
        ("Benefits", "benefits"),
        ("Perks & Benefits", "benefits"),
        ("WHAT WE OFFER", "benefits"),
        ("Why join us?", "benefits"),
        ("Technologies We Use", "tech_stack"),
        ("## Our stack", "tech_stack"),
        ("Interview process", "hiring_process"),
        ("Next steps", "hiring_process"),
        ("Location", "location_remote"),
        ("Time zone", "location_remote"),
        ("Equal Employment Opportunity", "equal_opportunity"),
        ("Our Commitment To Inclusion & Belonging", "equal_opportunity"),
        # Other languages.
        ("Deine Aufgaben", "responsibilities"),
        ("Dein Profil", "requirements"),
        ("Wir bieten", "benefits"),
        ("Vos missions", "responsibilities"),
        ("Requisitos", "requirements"),
        ("Yêu cầu", "requirements"),
        ("Phúc lợi", "benefits"),
        ("Mô tả công việc", "responsibilities"),
        # Not headings we know.
        ("Customer Experience Programs and Escalations Strategy", None),
        ("Hello world", None),
    ],
)
def test_classify_heading(heading, key):
    assert classify_heading(heading) == key


def test_parse_markdown_and_inline_key_values():
    text = "\n".join(
        [
            "Acme builds rockets.",
            "Salary: $120,000 - $150,000",
            "Location: Remote (US)",
            "## What you'll do",
            "- Build engines",
            "- Test engines",
            "**Requirements**",
            "- 5+ years of Python",
            "Our Fun Facts:",
            "- We like cake",
        ]
    )
    sections = parse_sections(text)
    assert [(s["key"], s["heading"]) for s in sections] == [
        ("intro", None),
        ("compensation", "Salary"),
        ("location_remote", "Location"),
        ("responsibilities", "What you'll do"),
        ("requirements", "Requirements"),
    ]
    # An unknown "…:" line inside a recognised section is a sub-heading of it.
    assert sections[-1]["body"] == "- 5+ years of Python\nOur Fun Facts:\n- We like cake"
    assert sections[1]["body"] == "$120,000 - $150,000"
    assert sections[3]["summary"] == "Build engines; Test engines"


def test_unknown_heading_after_the_intro_is_kept_as_other():
    text = "Intro text here.\nOUR FAVOURITE THINGS\n- Ship small\nBenefits\n- Gym"
    sections = parse_sections(text)
    assert [(s["key"], s["heading"]) for s in sections] == [
        ("intro", None),
        ("other", "OUR FAVOURITE THINGS"),
        ("benefits", "Benefits"),
    ]


def test_heading_only_section_takes_in_the_next_one():
    text = "WHAT YOU'LL DO\nIn this role, you'll:\n- Build things\nBenefits\n- Gym"
    sections = parse_sections(text)
    assert sections[0]["key"] == "responsibilities"
    assert sections[0]["heading"] == "WHAT YOU'LL DO"
    assert sections[0]["body"].startswith("In this role, you'll:\n- Build things")


def test_a_short_last_line_is_not_a_heading():
    assert [s["key"] for s in parse_sections("Requirements\n- Python\nThanks")] == ["requirements"]


def test_summary_is_capped():
    long = "- " + "word " * 200
    (section,) = parse_sections(f"Requirements\n{long}")
    assert len(section["summary"]) <= SUMMARY_MAX
    assert section["summary"].endswith("…")


@pytest.mark.parametrize("value", [None, "", "   \n "])
def test_empty_descriptions(value):
    assert parse_sections(value) is None


def test_parse_posting_stores_sections_only_when_something_was_recognised():
    job = BY_ID["1668"]
    parsed = derived.parse_posting(title=job["title"], description=job["description"], raw=None)
    assert parsed["sections"] is not None
    assert parsed["sections_version"] >= 1
    assert (parsed["level"], parsed["level_source"]) == ("junior", "title")
    teaser = derived.parse_posting(title="Cook", description="Make food. Apply now!", raw=None)
    assert teaser["sections"] is None
    assert teaser["level"] is None
