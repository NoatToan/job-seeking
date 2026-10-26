from urllib.parse import parse_qs, urlsplit

from job_crawler.session.sites import (
    SITES,
    SearchProfile,
    is_blocked,
    linkedin_search_url,
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
    assert first.url == "https://www.seek.com.au/job/81234567"
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
