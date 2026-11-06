import pytest

from job_crawler.db import job_params
from job_crawler.models import JobRecord
from job_crawler.timezones import (
    LOCATION,
    STATED,
    format_offset,
    job_timezones,
    location_timezones,
    stated_timezones,
)


def test_format_offset():
    assert format_offset(420) == "UTC+07:00"
    assert format_offset(-330) == "UTC-05:30"
    assert format_offset(0) == "UTC+00:00"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Must overlap with EST hours", ["America/New_York"]),
        ("Core hours 9-5 Pacific Time", ["America/Los_Angeles"]),
        ("We work in UTC+7", ["UTC+07:00"]),
        ("GMT+5:30 preferred", ["UTC+05:30"]),
        (
            "anywhere between UTC−3 to UTC+1",
            ["UTC-03:00", "UTC-02:00", "UTC-01:00", "UTC+00:00", "UTC+01:00"],
        ),
        ("CET or EST", ["Europe/Berlin", "America/New_York"]),
        ("Lorem est. ipsum, art gallery", []),
        ("UTC+20 is not a zone", []),
        (None, []),
    ],
)
def test_stated_timezones(text, expected):
    assert stated_timezones(text) == expected


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        ("Austin, TX", ["America/Chicago"]),
        ("San Francisco, CA", ["America/Los_Angeles"]),
        ("Toronto, CA (Canada)", ["America/Toronto"]),
        ("Ho Chi Minh City, Vietnam", ["Asia/Ho_Chi_Minh"]),
        ("Remote - UK", ["Europe/London"]),
        (
            "Remote - US",
            ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
        ),
        ("Europe", ["Europe/London", "Europe/Berlin", "Europe/Athens"]),
        ("Worldwide", []),
        ("Remote", []),
    ],
)
def test_location_timezones(location, expected):
    assert location_timezones(location) == expected


def test_job_timezones_prefers_structured_then_stated_then_location():
    raw = {"timezoneRestrictions": [-8, -7, -6, -5]}
    assert job_timezones("Worldwide", "EST", raw=raw) == (
        ["UTC-08:00", "UTC-07:00", "UTC-06:00", "UTC-05:00"],
        STATED,
    )
    assert job_timezones("Germany", "Overlap with EST") == (["America/New_York"], STATED)
    assert job_timezones("Germany", "No hours mentioned") == (["Europe/Berlin"], LOCATION)
    assert job_timezones("Worldwide", None) == (None, None)


def test_job_params_include_timezones():
    job = JobRecord(
        source="lever",
        external_id="1",
        url="https://example.test/1",
        title="Dev",
        company="Acme",
        location="Berlin",
        remote=False,
    )
    params = job_params(job)
    assert params["timezones"] == ["Europe/Berlin"]
    assert params["timezone_source"] == LOCATION
