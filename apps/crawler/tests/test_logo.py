import pytest

from job_crawler.derived import derive
from job_crawler.logo import job_logo, site_domain


def test_source_logo_wins():
    assert job_logo(
        "https://stripe.com/jobs/1", None, {"companyLogo": "https://cdn-images.himalayas.app/x"}
    ) == ("https://cdn-images.himalayas.app/x")
    assert job_logo(None, None, {"company_logo": "https://remotive.com/job/1/logo"}) == (
        "https://remotive.com/job/1/logo"
    )
    seek = {"branding": {"serpLogoUrl": "https://bx-branding-gateway.cloud.seek.com.au/a/jdpLogo"}}
    assert job_logo("https://www.seek.com.au/job/1", None, seek).endswith("/jdpLogo")


def test_insecure_or_junk_source_logo_is_ignored():
    assert job_logo(None, None, {"companyLogo": "http://x.test/logo.png"}) is None
    assert job_logo(None, None, {"companyLogo": None, "branding": None}) is None


def test_employer_site_icon_from_the_job_link():
    assert job_logo("https://stripe.com/jobs/search?gh_jid=1", None, {}) == (
        "https://icons.duckduckgo.com/ip3/stripe.com.ico"
    )
    # The job link is a board; the apply link is the employer's careers site.
    assert (
        job_logo("https://jobs.lever.co/acme/1", "https://careers.acme.com.au/apply/1", {})
        == "https://icons.duckduckgo.com/ip3/acme.com.au.ico"
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://jobs.lever.co/palantir/0f7d",
        "https://jobs.ashbyhq.com/acme/1",
        "https://weworkremotely.com/remote-jobs/x",
        "https://au.seek.com/job/1",
        "https://acme.wd5.myworkdayjobs.com/x",
        "https://127.0.0.1/x",
        "not a url",
        None,
    ],
)
def test_boards_and_junk_have_no_site(url):
    assert site_domain(url) is None


def test_derive_writes_company_logo():
    out = derive(
        title="Engineer",
        location=None,
        description=None,
        remote=True,
        raw={},
        url="https://jobs.stripe.com/x",
    )
    assert out["company_logo"] == "https://icons.duckduckgo.com/ip3/stripe.com.ico"


@pytest.fixture
def conn():
    import os

    import psycopg

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    with psycopg.connect(url) as connection, connection.transaction(force_rollback=True):
        yield connection


def test_logo_is_shared_by_company_name_and_kept_on_recompute(conn):
    from job_crawler import db
    from job_crawler.models import JobRecord

    def rec(source, ext, raw):
        return JobRecord(
            source=source,
            external_id=ext,
            url=f"https://jobs.lever.co/acme/{ext}",
            title="Dev",
            company="Acme",
            raw=raw,
        )

    db.upsert_jobs(
        conn, [rec("himalayas", "logo-h", {"companyLogo": "https://cdn-images.himalayas.app/acme"})]
    )
    db.upsert_jobs(conn, [rec("lever", "logo-l", {})])
    assert db.share_company_logos(conn) >= 1
    db.recompute_derived(conn)
    db.upsert_jobs(conn, [rec("lever", "logo-l", {})])  # a re-crawl without a logo keeps it
    logo = conn.execute(
        "SELECT company_logo FROM jobs WHERE source = 'lever' AND external_id = 'logo-l'"
    ).fetchone()[0]
    assert logo == "https://cdn-images.himalayas.app/acme"
