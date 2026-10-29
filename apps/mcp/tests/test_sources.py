import json

import pytest

from job_search_mcp.sources import arc, seek, wwr
from job_search_mcp.sources.common import matches, strip_html

# Shapes below are trimmed from live responses (Oct 2026).

SEEK_PAYLOAD = {
    "totalCount": 1,
    "data": [
        {
            "id": 95374556,
            "title": "React & React Native Developer",
            "advertiser": {"description": "PRA"},
            "locations": [{"label": "Richmond, Melbourne VIC"}],
            "workTypes": ["Contract/Temp"],
            "workArrangements": {
                "data": [{"id": "3", "label": {"text": "Remote"}}],
                "displayText": "Remote",
            },
            "salaryLabel": "$800/Per Day",
            "listingDate": "2026-10-20T04:28:25Z",
            "teaser": "Build <b>mobile</b> apps &amp; web",
        }
    ],
}

WWR_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Typeform: Full Stack Developer</title>
    <region>Anywhere in the World</region>
    <country>🇪🇸 Spain</country>
    <skills>React, Node</skills>
    <category>Full-Stack Programming</category>
    <type>Contract</type>
    <description>&lt;p&gt;Remote &lt;b&gt;TypeScript&lt;/b&gt; role&lt;/p&gt;</description>
    <pubDate>Sat, 10 Oct 2026 07:31:08 +0000</pubDate>
    <link>https://weworkremotely.com/remote-jobs/typeform-full-stack-developer</link>
  </item>
  <item>
    <title>Salesloft: HR Enablement Lead</title>
    <region>USA Only</region>
    <category>Management and Finance</category>
    <type>Full-Time</type>
    <description>People ops</description>
    <link>https://weworkremotely.com/remote-jobs/salesloft-hr-enablement-lead</link>
  </item>
</channel></rss>"""


def arc_page(arc_jobs: list[dict], external_jobs: list[dict]) -> str:
    data = {"props": {"pageProps": {"arcJobs": arc_jobs, "externalJobs": external_jobs}}}
    return (
        '<html><script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">'
        f"{json.dumps(data)}</script></html>"
    )


ARC_EXCLUSIVE = {
    "randomKey": "pstzrawmr6",
    "title": "Freelance React Native Developer",
    "jobType": "contract",
    "urlString": "freelance-react-native-developer",
    "postedAt": 1793268458,
    "minHourlyRate": 30,
    "maxHourlyRate": 45,
    "experienceLevel": "senior",
    "requiredCountries": [],
    "company": {"randomKey": None},
    "categories": [{"name": "React Native"}, {"name": "TypeScript"}],
}
ARC_EXTERNAL = {
    "randomKey": "pthqx2aiqw",
    "title": "Senior Product Designer",
    "jobType": "permanent",
    "urlString": "nextiva-senior-product-designer",
    "postedAt": 1793206385,
    "experienceLevels": ["senior"],
    "requiredCountries": ["US"],
    "company": {"name": "Nextiva"},
    "categories": [{"name": "Figma"}],
}


def test_strip_html_unescapes_and_truncates():
    assert strip_html("<p>A &amp; <b>B</b></p>") == "A & B"
    assert strip_html("x" * 10, limit=4) == "xxxx…"
    assert strip_html(None) == ""


def test_matches_needs_every_keyword_in_any_field():
    assert matches("react node", "React dev", "Node, AWS")
    assert not matches("react python", "React dev", None)
    assert matches(None, "anything")


def test_seek_params_map_filters_to_seek_ids():
    params = seek.search_params("react", "Sydney NSW", "contract", True, 7, "nz", 500)
    assert params["siteKey"] == "NZ-Main"
    assert params["worktype"] == 244
    assert params["workarrangement"] == 3
    assert params["daterange"] == 7
    assert params["pageSize"] == 100


def test_seek_parse():
    [job] = seek.parse(SEEK_PAYLOAD)
    assert job["company"] == "PRA"
    assert job["arrangement"] == "Remote"
    assert job["summary"] == "Build mobile apps & web"
    assert job["url"] == "https://www.seek.com.au/job/95374556"


def test_wwr_parse_splits_company_and_filters():
    jobs = wwr.parse(WWR_RSS)
    assert [j["company"] for j in jobs] == ["Typeform", "Salesloft"]
    assert jobs[0]["title"] == "Full Stack Developer"

    assert [j["company"] for j in wwr.parse(WWR_RSS, job_type="contract")] == ["Typeform"]
    # keywords also search skills and the HTML description
    assert [j["company"] for j in wwr.parse(WWR_RSS, keywords="typescript node")] == ["Typeform"]
    assert len(wwr.parse(WWR_RSS, limit=1)) == 1


def test_arc_parse_builds_detail_url_and_salary():
    jobs = arc.parse(arc_page([ARC_EXCLUSIVE], [ARC_EXTERNAL]))
    exclusive, external = jobs
    assert exclusive["url"] == (
        "https://arc.dev/remote-jobs/details/freelance-react-native-developer-pstzrawmr6"
    )
    assert exclusive["salary"] == "$30–45/hr"
    assert exclusive["arc_exclusive"] and exclusive["location"] == "Worldwide"
    assert external["company"] == "Nextiva" and external["location"] == "US"
    assert external["salary"] is None


def test_arc_parse_filters_job_type_and_keywords():
    page = arc_page([ARC_EXCLUSIVE], [ARC_EXTERNAL])
    assert [j["title"] for j in arc.parse(page, job_type="permanent")] == [
        "Senior Product Designer"
    ]
    assert [j["title"] for j in arc.parse(page, keywords="typescript")] == [
        "Freelance React Native Developer"
    ]


def test_arc_parse_fails_loudly_when_layout_changes():
    with pytest.raises(RuntimeError, match="__NEXT_DATA__"):
        arc.parse("<html></html>")


def test_arc_slug():
    assert arc.slug("Node.js") == "node-js"
    assert arc.slug(" React Native ") == "react-native"
