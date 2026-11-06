"""Seniority level (job_crawler.level): board data first, then the title, then the description."""

import json
from pathlib import Path

import pytest

from job_crawler.level import (
    LEVELS,
    from_description,
    from_source,
    from_title,
    job_level,
    years_of_experience,
)

FIXTURE = Path(__file__).parent / "fixtures" / "jd_sample.json"
JOBS = json.loads(FIXTURE.read_text())["jobs"]


@pytest.mark.parametrize(
    ("raw", "level"),
    [
        ({"seniority": ["Senior"]}, "senior"),
        ({"seniority": ["Mid-level", "Senior"]}, "mid"),  # open from the lowest
        ({"seniority": ["Entry-level"]}, "junior"),
        ({"seniority": ["Executive"]}, "director"),
        ({"experienceLevel": "senior"}, "senior"),  # Arc
        ({"experienceLevels": ["staff"]}, "lead"),  # Arc
        ({"seniorityLevel": "Mid-Senior level"}, "senior"),
        ({"seniority": ["Unknown"]}, None),
        ({}, None),
        (None, None),
    ],
)
def test_from_source(raw, level):
    assert from_source(raw) == level


@pytest.mark.parametrize(
    ("title", "level"),
    [
        ("Product Design Intern", "intern"),
        ("Software Engineer, Internship - Query Engines", "intern"),
        ("Werkstudent Softwareentwicklung (m/w/d)", "intern"),
        ("Thực tập sinh Frontend", "intern"),
        ("Junior Full Stack Engineer - Hybrid", "junior"),
        ("Forward Deployed Software Engineer, New Grad", "junior"),
        ("Associate Data Engineer", "junior"),
        ("Payments Risk Specialist I", "junior"),
        ("Intermediate Backend Engineer, Security Factory", "mid"),
        ("Software Development Engineer II (Remote @ Colombia)", "mid"),
        ("Customer Support Specialist ll", "mid"),
        ("Senior Software Engineer", "senior"),
        ("Sr. Data Engineer", "senior"),
        ("Sr DataOps Engineer (R14334)", "senior"),
        ("Senior Product Manager", "senior"),  # an IC "manager": the seniority word decides
        ("Tier III Service Desk Engineer", "senior"),
        ("Staff Software Engineer - Front End", "lead"),
        ("Principal Software Engineer", "lead"),
        ("Tech Lead – Full Stack Development", "lead"),
        ("Engineering Manager, Billing", "manager"),
        ("Senior Engineering Manager - Partner Ecosystem", "manager"),
        ("Manager, Customer Success Manager (PubSec)", "manager"),
        ("Head of Engineering", "director"),
        ("Director of Product Management, Platforms", "director"),
        ("VP of Sales", "director"),
        ("Chief Technology Officer", "director"),
        # No level in the title.
        ("Product Manager - Realtime", None),
        ("Account Manager", None),
        ("Executive Assistant to the CEO", None),
        ("Lead Generation Specialist", None),
        ("Software Engineer", None),
        ("Data Entry Clerk", None),
        ("Early-stage Startup Engineer", None),
        (None, None),
    ],
)
def test_from_title(title, level):
    assert from_title(title) == level


@pytest.mark.parametrize(
    ("text", "years"),
    [
        ("You have 5+ years of experience with Go.", 5),
        ("3-5 years' experience in SaaS sales", 3),
        ("At least 4 years in a similar role", 4),
        # "5+ years managing a team" is on top of the 12: only "… experience" phrases count.
        ("12+ years of overall engineering experience with 5+ years managing a team", 12),
        ("Minimum 2 years working with React", 2),
        ("We were founded 10 years ago.", None),
        ("", None),
    ],
)
def test_years_of_experience(text, years):
    assert years_of_experience(text) == years


@pytest.mark.parametrize(
    ("text", "level"),
    [
        ("Requirements\n- 1+ year of experience with SQL", "junior"),
        ("- 3+ years of professional experience", "mid"),
        ("- 6+ years of experience building APIs", "senior"),
        ("This is an entry-level role. No experience required.", "junior"),
        ("This is a paid internship for students.", "intern"),
        ("Great team, great product.", None),
    ],
)
def test_from_description(text, level):
    assert from_description(text) == level


def test_source_beats_title_beats_description():
    desc = "- 1 year of experience"
    assert job_level("Senior Engineer", desc, {"seniority": ["Mid-level"]}) == ("mid", "source")
    assert job_level("Senior Engineer", desc, {}) == ("senior", "title")
    assert job_level("Engineer", desc, {}) == ("junior", "description")
    assert job_level("Engineer", "Build things.", None) == (None, None)


def test_fixture_levels_by_source():
    """Every sampled job gets a known level or None, and where the board sends one it is used."""
    found = {}
    for job in JOBS:
        level, source = job_level(job["title"], job["description"], job["raw"])
        assert level is None or level in LEVELS
        assert (level is None) == (source is None)
        if job["raw"].get("seniority"):
            assert source == "source", job["title"]
        found[job["id"]] = level
    assert found["7428"] == "intern"  # "Product Design Intern"
    assert found["6530"] == "director"  # "Head of Creative Operations"
    assert found["14016"] == "mid"  # Himalayas seniority ["Mid-level"]
    assert sum(v is not None for v in found.values()) / len(found) >= 0.65
