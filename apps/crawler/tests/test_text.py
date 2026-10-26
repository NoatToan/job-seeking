from datetime import UTC, datetime, timedelta, timezone

import pytest

from job_crawler.text import clean, format_salary, html_to_text, parse_datetime


def test_html_to_text_blocks_lists_and_entities():
    html = "<h2>Role</h2><p>Hello&nbsp;&amp;   welcome</p><ul><li>One</li><li>Two</li></ul>"
    assert html_to_text(html) == "Role\n\nHello & welcome\n\n- One\n\n- Two"


def test_html_to_text_skips_script_and_style():
    html = "<style>p {}</style><p>Visible</p><script>alert(1)</script>"
    assert html_to_text(html) == "Visible"


def test_html_to_text_escaped():
    escaped = "&lt;p&gt;Hi &lt;b&gt;there&lt;/b&gt;&lt;/p&gt;"
    assert html_to_text(escaped, escaped=True) == "Hi there"


@pytest.mark.parametrize("value", [None, "", "<p> </p>", "<script>x</script>"])
def test_html_to_text_empty(value):
    assert html_to_text(value) is None


def test_html_to_text_collapses_blank_lines():
    assert html_to_text("<p>a</p><br><br><br><p>b</p>") == "a\n\nb"


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, None), ("", None), ("   ", None), ("  x ", "x"), (42, "42")],
)
def test_clean(value, expected):
    assert clean(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2026-10-01T12:00:00Z", datetime(2026, 10, 1, 12, tzinfo=UTC)),
        ("2026-10-01T12:00:00", datetime(2026, 10, 1, 12, tzinfo=UTC)),
        (
            "2026-10-01T12:00:00+07:00",
            datetime(2026, 10, 1, 12, tzinfo=timezone(timedelta(hours=7))),
        ),
        (1760000000, datetime.fromtimestamp(1760000000, tz=UTC)),
        (1760000000000, datetime.fromtimestamp(1760000000, tz=UTC)),
        ("1760000000", datetime.fromtimestamp(1760000000, tz=UTC)),
        (None, None),
        ("", None),
        ("not a date", None),
    ],
)
def test_parse_datetime(value, expected):
    assert parse_datetime(value) == expected


def test_parse_datetime_is_always_aware():
    dt = parse_datetime("2026-10-01")
    assert dt is not None and dt.tzinfo is not None


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        ((100000, 150000, "USD", "annual"), "USD 100,000 - 150,000 / annual"),
        ((100000, 100000, "GBP"), "GBP 100,000"),
        ((None, 50000), "50,000"),
        ((40000, None, None, "year"), "40,000 / year"),
        ((None, None, "USD"), None),
        ((0, 0), None),
        (("", ""), None),
        (("abc", None), "abc"),
    ],
)
def test_format_salary(args, expected):
    assert format_salary(*args) == expected
