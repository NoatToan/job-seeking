import httpx

from job_crawler import profile_search
from job_crawler.http import HttpClient
from job_crawler.session.sites import SearchProfile
from job_crawler.sources import remotive

REMOTIVE_PAYLOAD = {
    "jobs": [
        {
            "id": 1934567,
            "url": "https://remotive.com/remote-jobs/software-dev/senior-next-js-engineer-1934567",
            "title": " Senior Next.js Engineer ",
            "company_name": "Acme",
            "tags": ["next.js", "react", ""],
            "job_type": "full_time",
            "publication_date": "2026-10-20T08:00:00",
            "candidate_required_location": "Worldwide",
            "salary": "$80k - $110k",
            "description": "<p>Build <b>Next.js</b> apps. Visa sponsorship available.</p>",
        },
        {"id": 2, "url": "", "title": "no url"},
    ]
}


def test_parse_remotive():
    (job,) = remotive.parse(REMOTIVE_PAYLOAD)
    assert job.source == "remotive" and job.external_id == "1934567"
    assert job.title == "Senior Next.js Engineer" and job.company == "Acme"
    assert job.location == "Worldwide" and job.remote
    assert job.employment_type == "full time"
    assert job.tags == ["next.js", "react"]
    assert "Visa sponsorship" in (job.description or "")
    assert "description" not in job.raw


def _himalayas_page(n: int, total: int) -> dict:
    return {
        "totalCount": total,
        "jobs": [
            {
                "title": f"Next.js dev {n}-{i}",
                "companyName": "Co",
                "guid": f"https://himalayas.app/companies/co/jobs/{n}-{i}",
                "locationRestrictions": ["Vietnam"],
            }
            for i in range(20 if n * 20 <= total else total % 20)
        ],
    }


def test_himalayas_search_paginates_until_total():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        calls.append((request.url.params["q"], page))
        return httpx.Response(200, json=_himalayas_page(page, total=45))

    http = HttpClient(transport=httpx.MockTransport(handler), board_delay=0)
    jobs = profile_search.himalayas_search(http, "next.js")
    assert len(jobs) == 45
    assert calls == [("next.js", 1), ("next.js", 2), ("next.js", 3)]
    assert jobs[0].location == "Vietnam"


def test_wanted_respects_profile_sources():
    p = SearchProfile(1, "x", "next.js", [], True, ["remotive"])
    assert profile_search.wanted(p, "remotive") and not profile_search.wanted(p, "himalayas")
    assert profile_search.wanted(SearchProfile(2, "y", "a", [], False, []), "himalayas")
