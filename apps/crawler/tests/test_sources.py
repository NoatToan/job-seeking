from datetime import UTC, datetime

import pytest

from job_crawler.models import Board, SkipSource
from job_crawler.sources import adzuna, ashby, greenhouse, himalayas, lever, weworkremotely

WWR_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>We Work Remotely: Programming</title>
  <item>
    <title>Acme Inc: Senior Python Engineer</title>
    <region>Anywhere in the World</region>
    <country>Worldwide</country>
    <skills>Python and Django</skills>
    <category>Programming</category>
    <type>Full-Time</type>
    <description>&lt;p&gt;Build &lt;strong&gt;things&lt;/strong&gt;.&lt;/p&gt;</description>
    <pubDate>Mon, 20 Oct 2026 10:00:00 +0000</pubDate>
    <guid>https://weworkremotely.com/remote-jobs/acme-senior-python-engineer</guid>
    <link>https://weworkremotely.com/remote-jobs/acme-senior-python-engineer</link>
  </item>
  <item>
    <title>Title without company</title>
    <link>https://weworkremotely.com/remote-jobs/no-company</link>
  </item>
  <item>
    <title></title>
    <link>https://weworkremotely.com/remote-jobs/empty-title</link>
  </item>
</channel>
</rss>
"""


def test_weworkremotely_parse():
    jobs = weworkremotely.parse(WWR_FEED)
    assert len(jobs) == 2
    job = jobs[0]
    assert job.source == "weworkremotely"
    assert job.external_id == "https://weworkremotely.com/remote-jobs/acme-senior-python-engineer"
    assert job.company == "Acme Inc"
    assert job.title == "Senior Python Engineer"
    assert job.location == "Anywhere in the World"
    assert job.employment_type == "Full-Time"
    assert job.remote is True
    assert job.description == "Build things."
    assert job.tags == ["Programming", "Python", "Django"]
    assert job.posted_at == datetime(2026, 10, 20, 10, 0, tzinfo=UTC)
    assert jobs[1].company == "Unknown"
    assert jobs[1].title == "Title without company"


GH_BOARD = Board(ats="greenhouse", slug="acme", company_name="Acme")


def test_greenhouse_parse():
    payload = {
        "jobs": [
            {
                "id": 123,
                "title": " Backend Engineer ",
                "absolute_url": "https://boards.greenhouse.io/acme/jobs/123",
                "location": {"name": "Remote - US"},
                "departments": [{"name": "Engineering"}, {"name": ""}],
                "content": "&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;",
                "first_published": "2026-10-01T12:00:00-04:00",
                "updated_at": "2026-10-05T12:00:00Z",
            },
            {"id": 124, "title": "No URL"},
            {
                "id": 125,
                "title": "Office role",
                "absolute_url": "https://boards.greenhouse.io/acme/jobs/125",
                "company_name": "Acme Labs",
                "location": {"name": "Berlin"},
                "updated_at": "2026-10-05T12:00:00Z",
            },
        ]
    }
    jobs = greenhouse.parse(payload, GH_BOARD)
    assert [j.external_id for j in jobs] == ["acme:123", "acme:125"]
    job = jobs[0]
    assert job.title == "Backend Engineer"
    assert job.company == "Acme"
    assert job.location == "Remote - US"
    assert job.remote is True
    assert job.description == "Hello & welcome"
    assert job.tags == ["Engineering"]
    assert job.posted_at == datetime(2026, 10, 1, 16, 0, tzinfo=UTC)
    assert jobs[1].company == "Acme Labs"
    assert jobs[1].remote is False
    assert jobs[1].posted_at == datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


def test_greenhouse_parse_empty_payload():
    assert greenhouse.parse({}, GH_BOARD) == []


LEVER_BOARD = Board(ats="lever", slug="acme", company_name="Acme")


def test_lever_parse():
    payload = [
        {
            "id": "abc-1",
            "text": "Frontend Engineer",
            "hostedUrl": "https://jobs.lever.co/acme/abc-1",
            "applyUrl": "https://jobs.lever.co/acme/abc-1/apply",
            "categories": {
                "location": "Toronto",
                "team": "Web",
                "department": "Engineering",
                "commitment": "Full-time",
            },
            "workplaceType": "remote",
            "description": "<p>Intro</p>",
            "lists": [{"text": "Requirements", "content": "<li>React</li><li>TS</li>"}],
            "additional": "<p>Benefits</p>",
            "salaryRange": {
                "min": 100000,
                "max": 150000,
                "currency": "USD",
                "interval": "per-year-salary",
            },
            "createdAt": 1760000000000,
        },
        {
            "id": "abc-2",
            "text": "Designer",
            "hostedUrl": "https://jobs.lever.co/acme/abc-2",
            "categories": {"location": "Remote, EU", "team": "Design", "department": "Design"},
            "salaryDescriptionPlain": " Competitive ",
        },
        {"id": "abc-3", "hostedUrl": "https://jobs.lever.co/acme/abc-3"},
    ]
    jobs = lever.parse(payload, LEVER_BOARD)
    assert [j.external_id for j in jobs] == ["acme:abc-1", "acme:abc-2"]
    job = jobs[0]
    assert job.title == "Frontend Engineer"
    assert job.company == "Acme"
    assert job.apply_url == "https://jobs.lever.co/acme/abc-1/apply"
    assert job.remote is True
    assert job.employment_type == "Full-time"
    assert job.salary_text == "USD 100,000 - 150,000 / per year salary"
    assert job.description == "Intro\n\nRequirements\n- React\n\n- TS\n\nBenefits"
    assert job.tags == ["Web", "Engineering"]
    assert job.posted_at == datetime.fromtimestamp(1760000000, tz=UTC)
    second = jobs[1]
    assert second.apply_url == second.url
    assert second.remote is True
    assert second.salary_text == "Competitive"
    assert second.tags == ["Design"]
    assert second.description is None


def test_lever_parse_empty_payload():
    assert lever.parse([], LEVER_BOARD) == []


ASHBY_BOARD = Board(ats="ashby", slug="acme", company_name="Acme")


def test_ashby_parse():
    payload = {
        "jobs": [
            {
                "id": "j1",
                "title": "Platform Engineer",
                "jobUrl": "https://jobs.ashbyhq.com/acme/j1",
                "applyUrl": "https://jobs.ashbyhq.com/acme/j1/application",
                "location": "New York",
                "workplaceType": "Remote",
                "isRemote": False,
                "employmentType": "FullTime",
                "department": "Engineering",
                "team": "Engineering",
                "compensation": {"scrapeableCompensationSalarySummary": "$150K - $200K"},
                "descriptionPlain": "Plain description",
                "descriptionHtml": "<p>HTML description</p>",
                "publishedAt": "2026-09-30T08:00:00.000+00:00",
                "isListed": True,
            },
            {
                "id": "j2",
                "title": "Hidden",
                "jobUrl": "https://jobs.ashbyhq.com/acme/j2",
                "isListed": False,
            },
            {
                "id": "j3",
                "title": "Contractor",
                "jobUrl": "https://jobs.ashbyhq.com/acme/j3",
                "employmentType": "Contract",
                "compensation": {"compensationTierSummary": "€50 - €70 per hour"},
                "descriptionHtml": "<p>HTML only</p>",
            },
        ]
    }
    jobs = ashby.parse(payload, ASHBY_BOARD)
    assert [j.external_id for j in jobs] == ["acme:j1", "acme:j3"]
    job = jobs[0]
    assert job.apply_url == "https://jobs.ashbyhq.com/acme/j1/application"
    assert job.company == "Acme"
    assert job.remote is True
    assert job.employment_type == "Full Time"
    assert job.salary_text == "$150K - $200K"
    assert job.description == "Plain description"
    assert job.tags == ["Engineering"]
    assert job.posted_at == datetime(2026, 9, 30, 8, 0, tzinfo=UTC)
    other = jobs[1]
    assert other.apply_url == other.url
    assert other.remote is False
    assert other.employment_type == "Contract"
    assert other.salary_text == "€50 - €70 per hour"
    assert other.description == "HTML only"


def test_himalayas_parse():
    payload = {
        "totalCount": 2,
        "jobs": [
            {
                "title": "Data Engineer ",
                "guid": "https://himalayas.app/companies/acme/jobs/data-engineer",
                "applicationLink": "https://acme.com/apply",
                "companyName": "Acme",
                "locationRestrictions": ["United States", "Canada"],
                "parentCategories": ["Engineering"],
                "seniority": ["Senior", "Engineering"],
                "employmentType": "Full Time",
                "minSalary": 90000,
                "maxSalary": 120000,
                "currency": "USD",
                "salaryPeriod": "annual",
                "description": "<p>Data <em>pipelines</em></p>",
                "excerpt": "Short",
                "pubDate": 1760000000,
            },
            {
                "title": "Support",
                "applicationLink": "https://other.com/apply",
                "excerpt": "Help customers",
            },
            {"title": "No link"},
        ],
    }
    jobs = himalayas.parse(payload)
    assert len(jobs) == 2
    job = jobs[0]
    assert job.external_id == "https://himalayas.app/companies/acme/jobs/data-engineer"
    assert job.apply_url == "https://acme.com/apply"
    assert job.title == "Data Engineer"
    assert job.location == "United States, Canada"
    assert job.remote is True
    assert job.salary_text == "USD 90,000 - 120,000 / annual"
    assert job.description == "Data pipelines"
    assert job.tags == ["Engineering", "Senior"]
    assert job.posted_at == datetime.fromtimestamp(1760000000, tz=UTC)
    other = jobs[1]
    assert other.external_id == "https://other.com/apply"
    assert other.company == "Unknown"
    assert other.location == "Worldwide"
    assert other.salary_text is None
    assert other.description == "Help customers"


def test_adzuna_parse():
    payload = {
        "results": [
            {
                "id": "4242",
                "title": "<strong>Remote</strong> Software Developer",
                "redirect_url": "https://www.adzuna.com.au/land/ad/4242",
                "company": {"display_name": "Acme Pty"},
                "location": {"display_name": "Sydney, New South Wales"},
                "contract_time": "full_time",
                "contract_type": "permanent",
                "category": {"label": "IT Jobs"},
                "salary_min": 100000,
                "salary_max": 100000,
                "description": "Write <b>code</b>",
                "created": "2026-10-20T03:00:00Z",
            },
            {
                "id": "4243",
                "title": "Developer",
                "redirect_url": "https://www.adzuna.com.au/land/ad/4243",
            },
            {"id": "4244", "title": "No URL"},
        ]
    }
    jobs = adzuna.parse(payload, "au")
    assert [j.external_id for j in jobs] == ["au:4242", "au:4243"]
    job = jobs[0]
    assert job.title == "Remote Software Developer"
    assert job.company == "Acme Pty"
    assert job.location == "Sydney, New South Wales"
    assert job.remote is True
    assert job.employment_type == "full time permanent"
    assert job.salary_text == "AUD 100,000"
    assert job.description == "Write code"
    assert job.tags == ["IT Jobs"]
    assert job.posted_at == datetime(2026, 10, 20, 3, 0, tzinfo=UTC)
    other = jobs[1]
    assert other.company == "Unknown"
    assert other.remote is False
    assert other.employment_type is None
    assert other.salary_text is None
    assert other.tags == []


class _NoHttp:
    def __getattr__(self, name):
        raise AssertionError("fetch must not make requests without credentials")


def test_adzuna_fetch_skips_without_credentials(monkeypatch):
    monkeypatch.delenv("ADZUNA_APP_ID", raising=False)
    monkeypatch.delenv("ADZUNA_APP_KEY", raising=False)
    with pytest.raises(SkipSource):
        adzuna.fetch(_NoHttp(), [])


@pytest.mark.parametrize(
    ("present", "missing"),
    [("ADZUNA_APP_ID", "ADZUNA_APP_KEY"), ("ADZUNA_APP_KEY", "ADZUNA_APP_ID")],
)
def test_adzuna_fetch_skips_with_partial_credentials(monkeypatch, present, missing):
    monkeypatch.setenv(present, "placeholder")
    monkeypatch.delenv(missing, raising=False)
    with pytest.raises(SkipSource):
        adzuna.fetch(_NoHttp(), [])
