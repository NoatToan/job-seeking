import pytest

from job_crawler.eligibility import accepts, open_to

HIMALAYAS_LIST = ["Albania", "Argentina", "Czechia", "United Kingdom", "United States", "Vietnam"]


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        ("Worldwide", ["WORLDWIDE"]),
        ("Anywhere in the World", ["WORLDWIDE"]),
        ("Remote - Global", ["WORLDWIDE"]),
        ("Remote", None),
        ("", None),
        ("Remote - US", ["US"]),
        ("USA Only", ["US"]),
        ("Remote (US, CA)", ["CA", "US"]),
        ("United States, Canada", ["CA", "US"]),
        ("San Francisco, CA", ["US"]),
        ("Austin, TX (Remote)", ["US"]),
        ("Europe Only", ["EUROPE"]),
        ("EMEA", ["EMEA"]),
        ("APAC", ["APAC"]),
        ("Remote, Vietnam", ["VN"]),
        ("Ho Chi Minh City, Vietnam", ["VN"]),
        ("Americas", ["AMERICAS"]),
        ("LATAM", ["LATAM"]),
        ("Latin America", ["LATAM"]),
        ("North America", ["NORTH_AMERICA"]),
        ("UK", ["GB"]),
        ("Remote - Germany", ["DE"]),
        ("London", ["GB"]),
        ("Sydney NSW", ["AU"]),
        ("Singapore", ["SG"]),
        ("Southeast Asia", ["SEA"]),
        ("Remote - work with us from home", None),
        ("Armenia", ["AM"]),
        ("Bosnia and Herzegovina", ["BA"]),
    ],
)
def test_open_to(location, expected):
    assert open_to(location, True) == expected


def test_not_remote_is_unknown():
    assert open_to("Worldwide", False) is None


def test_extra_structured_countries():
    tokens = open_to("Albania, Argentina +4", True, HIMALAYAS_LIST)
    assert "VN" in tokens and "US" in tokens and "CZ" in tokens
    assert open_to("Remote", True, ["US", "CA"]) == ["CA", "US"]


def test_accepts():
    assert accepts(["WORLDWIDE"], "VN") is True
    assert accepts(["US"], "VN") is False
    assert accepts(["CA", "US"], "VN") is False
    assert accepts(["APAC"], "VN") is True
    assert accepts(["SEA"], "VN") is True
    assert accepts(["EUROPE"], "VN") is False
    assert accepts(None, "VN") is None
    assert accepts(open_to("Albania", True, HIMALAYAS_LIST), "VN") is True


def test_every_iso_country_name_is_recognised():
    assert open_to("Curaçao", True) == ["CW"]
    assert open_to("Remote - Senegal", True) == ["SN"]
    assert open_to("Mali or Somalia", True) == ["ML", "SO"]
    assert open_to("Papua New Guinea", True) == ["PG"]


def test_extra_country_codes_are_not_matched_in_text():
    # "NC" is New Caledonia's code but in locations it means North Carolina.
    assert open_to("Charlotte, NC", True) == ["US"]
    assert open_to("Remote (NC)", True) is None
