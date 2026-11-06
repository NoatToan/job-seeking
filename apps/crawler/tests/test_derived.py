from job_crawler.db import UPSERT_SQL
from job_crawler.derived import DERIVED_COLUMNS, derive, job_countries


def test_job_countries_covers_on_site_jobs_and_skips_regions():
    assert job_countries("Berlin, Germany") == ["DE"]
    assert job_countries("Remote - US or Canada") == ["CA", "US"]
    assert job_countries("Europe") is None
    assert job_countries("Worldwide") is None
    assert job_countries(None, ["Vietnam", "Singapore"]) == ["SG", "VN"]


def test_derive_returns_every_derived_column():
    fields = derive(
        title="Dev", location="Berlin, Germany", description="CET hours", remote=False, raw={}
    )
    assert set(fields) == set(DERIVED_COLUMNS)
    assert fields["countries"] == ["DE"]
    assert fields["timezones"] == ["Europe/Berlin"]
    assert fields["open_to"] is None  # on-site


def test_upsert_writes_every_derived_column():
    for column in DERIVED_COLUMNS:
        assert f"%({column})s" in UPSERT_SQL
        assert f"{column} = EXCLUDED.{column}" in UPSERT_SQL


def test_salary_prefers_the_source_text_then_the_posting():
    from_source = derive(
        title="Dev",
        location=None,
        description="Pay: $90k",
        remote=True,
        raw={},
        salary_text="USD 120,000 - 130,000 / annual",
    )
    assert (from_source["salary_min"], from_source["salary_max"]) == (120000, 130000)
    assert from_source["salary_currency"] == "USD"
    assert from_source["salary_period"] == "year"
    assert from_source["salary_source"] == "source"

    from_text = derive(
        title="Dev",
        location=None,
        description="We pay €60.000 - €75.000 per year",
        remote=True,
        raw={},
    )
    assert from_text["salary_currency"] == "EUR"
    assert from_text["salary_source"] == "description"

    none = derive(title="Dev", location=None, description="We raised $50M", remote=True, raw={})
    assert none["salary_min"] is None and none["salary_source"] is None
