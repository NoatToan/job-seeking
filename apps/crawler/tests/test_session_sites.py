from urllib.parse import parse_qs, urlsplit

from job_crawler.session.sites import (
    SITES,
    SearchProfile,
    arc_search_url,
    glassdoor_search_url,
    is_blocked,
    linkedin_search_url,
    parse_arc,
    parse_glassdoor,
    parse_linkedin,
    parse_seek,
    seek_search_url,
)

PROFILE = SearchProfile(
    id=1,
    name="React",
    keywords='"react native" typescript -intern',
    locations=[],
    remote_only=True,
    sources=[],
)

LINKEDIN_HTML = """
<ul>
  <li data-occludable-job-id="4012345678">
    <div class="job-card-container">
      <a class="job-card-container__link" href="/jobs/view/4012345678/?refId=x"
         aria-label="Senior React Native Engineer">
        <strong>Senior React Native Engineer</strong></a>
      <div class="artdeco-entity-lockup__subtitle"><span>Canva</span></div>
      <div class="artdeco-entity-lockup__caption"><span>Sydney, NSW (Remote)</span></div>
    </div>
  </li>
  <li data-occludable-job-id="4012345678"><a href="/jobs/view/4012345678/">dup</a></li>
  <li class="ad"><a href="/jobs/view/frontend-dev-at-acme-4099999999">Frontend Dev</a></li>
  <li data-occludable-job-id="4000000001"></li>
</ul>
"""

SEEK_HTML = """
<div>
  <article data-card-type="JobCard" data-job-id="81234567">
    <a data-automation="jobTitle" href="/job/81234567?type=standard">Full Stack Developer</a>
    <a data-automation="jobCompany">Atlassian</a>
    <a data-automation="jobLocation">Sydney NSW</a>
    <a data-automation="jobLocation">CBD</a>
    <span data-automation="jobSalary">$150k – $170k + super</span>
    <span data-automation="jobWorkType">Full time</span>
    <span data-automation="jobShortDescription">Work from home 2 days a week.</span>
  </article>
  <article data-job-id="81234568">
    <a data-automation="jobTitle">React Engineer</a>
    <a data-automation="jobLocation">Remote</a>
  </article>
  <article data-job-id="not-a-number"><a data-automation="jobTitle">x</a></article>
</div>
"""


def test_linkedin_search_url_drops_web_search_syntax():
    q = parse_qs(urlsplit(linkedin_search_url(PROFILE, "Vietnam", 1)).query)
    assert q["keywords"] == ["react native typescript"]
    assert q["location"] == ["Vietnam"]
    assert q["f_WT"] == ["2"] and q["start"] == ["25"] and q["f_TPR"] == ["r86400"]


def test_parse_linkedin_cards():
    jobs = parse_linkedin(LINKEDIN_HTML)
    by_id = {j.external_id: j for j in jobs}
    assert set(by_id) == {"4012345678", "4099999999"}
    job = by_id["4012345678"]
    assert job.title == "Senior React Native Engineer"
    assert job.company == "Canva"
    assert job.location == "Sydney, NSW (Remote)" and job.remote
    assert job.url == "https://www.linkedin.com/jobs/view/4012345678/"
    assert by_id["4099999999"].company == "Unknown"


def test_seek_search_url():
    url = seek_search_url(PROFILE, "Sydney NSW", 0)
    parts = urlsplit(url)
    assert parts.path == "/react-native-typescript-jobs/in-sydney-nsw"
    q = parse_qs(parts.query)
    assert q["daterange"] == ["1"] and q["page"] == ["1"] and q["where"] == ["Remote"]


def test_parse_seek_cards():
    jobs = parse_seek(SEEK_HTML)
    assert [j.external_id for j in jobs] == ["81234567", "81234568"]
    first, second = jobs
    assert first.title == "Full Stack Developer" and first.company == "Atlassian"
    assert first.location == "Sydney NSW, CBD"
    assert first.salary_text == "$150k – $170k + super"
    assert first.employment_type == "Full time" and not first.remote
    assert first.url == "https://au.seek.com/job/81234567"
    assert second.company == "Private advertiser" and second.remote


def test_block_markers():
    markers = SITES["linkedin"].block_markers
    assert any(m in "https://www.linkedin.com/checkpoint/challenge/x" for m in markers)
    assert not any(m in "https://www.linkedin.com/jobs/search/?k=1" for m in markers)


def test_cloudflare_interstitial_is_blocked():
    seek = SITES["seek"]
    assert is_blocked(seek, "https://www.seek.com.au/react-jobs", "Just a moment...")
    assert not is_blocked(
        seek, "https://www.seek.com.au/react-jobs", "React Jobs in All Australia - SEEK"
    )


def test_parse_linkedin_logged_out_cards():
    html = """
    <ul><li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4111111111">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/react-dev-4111111111?trk=x"></a>
      <h3 class="base-search-card__title"> React Developer </h3>
      <h4 class="base-search-card__subtitle"><a>Employment Hero</a></h4>
      <span class="job-search-card__location">Sydney, New South Wales, Australia</span>
    </div></li></ul>
    """
    (job,) = parse_linkedin(html)
    assert job.external_id == "4111111111"
    assert job.title == "React Developer" and job.company == "Employment Hero"
    assert job.location == "Sydney, New South Wales, Australia"


def _next_data(page_props: dict) -> str:
    import json

    payload = json.dumps({"props": {"pageProps": page_props}})
    return f'<html><script id="__NEXT_DATA__" type="application/json">{payload}</script></html>'


def test_arc_search_url_uses_category():
    assert arc_search_url(PROFILE, None, 0) == "https://arc.dev/remote-jobs/react-native-typescript"
    assert arc_search_url(PROFILE, None, 1).endswith("?page=2")
    nextjs = SearchProfile(
        id=2, name="n", keywords="Next.js", locations=[], remote_only=True, sources=[]
    )
    assert arc_search_url(nextjs, None, 0) == "https://arc.dev/remote-jobs/next-js"


def test_parse_arc_next_data():
    html = _next_data(
        {
            "arcJobs": [
                {
                    "randomKey": "pugy8dj8tg",
                    "title": "Senior React Developer",
                    "jobType": "contract",
                    "requiredCountries": [],
                    "minAnnualSalary": 90000,
                    "maxAnnualSalary": 120000,
                    "urlString": "senior-react-developer",
                    "postedAt": 1792963611,
                    "company": {"randomKey": None},
                    "categories": [{"name": "React"}, {"name": "TypeScript"}],
                }
            ],
            "externalJobs": [
                {
                    "randomKey": "ptsx1ez43g",
                    "title": "Frontend Engineer",
                    "jobType": "permanent",
                    "requiredCountries": ["US", "CA"],
                    "urlString": "acme-frontend-engineer",
                    "postedAt": 1792686229,
                    "company": {"name": "Acme"},
                    "categories": [],
                },
                {"randomKey": "pugy8dj8tg", "title": "dup", "urlString": "dup"},
            ],
        }
    )
    first, second = parse_arc(html)
    assert first.url == "https://arc.dev/remote-jobs/details/senior-react-developer-pugy8dj8tg"
    assert first.company == "Confidential (via Arc)" and first.remote
    assert first.tags == ["React", "TypeScript"] and first.salary_text
    assert first.posted_at is not None and first.posted_at.year == 2026
    assert second.company == "Acme" and second.location == "Remote (US, CA)"
    assert parse_arc("<html>no data</html>") == []


GLASSDOOR_HTML = """
<ul data-test="jobsList">
  <li data-test="jobListing" data-jobid="1009876543210">
    <a data-test="job-title"
       href="/job-listing/react-developer-acme-JV_IC2235932.htm?jl=1009876543210"
       >React Developer</a>
    <span class="EmployerProfile_compactEmployerName__abc12">Acme Pty Ltd</span>
    <div data-test="emp-location">Sydney</div>
    <div data-test="detailSalary">A$120K - A$140K (Employer est.)</div>
    <div data-test="descSnippet">Build React apps.</div>
  </li>
  <li data-test="jobListing" data-jobid="abc"><a data-test="job-title">bad id</a></li>
</ul>
"""


def test_glassdoor_search_url():
    q = parse_qs(urlsplit(glassdoor_search_url(PROFILE, "Sydney", 0)).query)
    assert q["sc.keyword"] == ["react native typescript"]
    assert q["locKeyword"] == ["Sydney"] and q["remoteWorkType"] == ["1"]


def test_parse_glassdoor_cards():
    (job,) = parse_glassdoor(GLASSDOOR_HTML)
    assert job.external_id == "1009876543210"
    assert job.title == "React Developer" and job.company == "Acme Pty Ltd"
    assert job.url.startswith("https://www.glassdoor.com/job-listing/react-developer-acme")
    assert job.salary_text == "A$120K - A$140K (Employer est.)"
    assert job.description == "Build React apps."
    assert SITES["glassdoor"].max_pages == 1


FIXTURES = __import__("pathlib").Path(__file__).parent / "fixtures"


def test_parse_glassdoor_live_rsc_page():
    """Real Glassdoor remote search page (fixture from the jobflow POC)."""
    jobs = parse_glassdoor((FIXTURES / "glassdoor_search.html").read_text())
    assert len(jobs) == 30
    job = next(j for j in jobs if j.external_id == "1010210609012")
    assert job.company == "AuraOne Human Data"
    assert job.salary_text and "70" in job.salary_text and "120" in job.salary_text
    assert "Python" in job.tags
    assert job.url.startswith("https://www.glassdoor.com/")


def test_parse_arc_live_listing_page():
    jobs = parse_arc((FIXTURES / "arc_listing.html").read_text())
    assert len(jobs) >= 30
    assert any("/remote-jobs/j/" in j.url for j in jobs)
    assert any("/remote-jobs/details/" in j.url for j in jobs)


def test_glassdoor_remote_search_url():
    remote = SearchProfile(
        id=1, name="x", keywords="Python  Developer", locations=[], remote_only=True, sources=[]
    )
    assert glassdoor_search_url(remote, None, 0) == (
        "https://www.glassdoor.com/Job/remote-python-developer-jobs-SRCH_IL.0,6_IS11047_KO7,23.htm"
    )


def test_arc_generic_page_is_not_a_result_page():
    arc = SITES["arc"]
    assert not arc.is_result_page("Remote Jobs (October 2026) - Arc")
    assert arc.is_result_page("Remote Next.js Jobs (October 2026) - Arc")
