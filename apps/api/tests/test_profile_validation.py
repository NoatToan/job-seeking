"""Pure (no DB) validation tests for `PATCH /api/me/profile` (`ProfilePatch`)."""

import pytest
from pydantic import ValidationError

from ujc_api.routers.profile import ProfilePatch


def test_only_sent_keys_are_marked_as_set():
    body = ProfilePatch.model_validate({"displayName": "Linh"})
    assert body.model_fields_set == {"displayName"}
    assert ProfilePatch.model_validate({}).model_fields_set == set()


def test_display_name_is_trimmed_and_whitespace_collapsed():
    assert ProfilePatch(displayName="  Nguyen   Van  A ").displayName == "Nguyen Van A"
    assert ProfilePatch(displayName="Trần Thị Bích").displayName == "Trần Thị Bích"


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_display_name_clears_it(value: str):
    body = ProfilePatch.model_validate({"displayName": value})
    assert body.displayName is None
    assert "displayName" in body.model_fields_set


@pytest.mark.parametrize("value", ["x" * 61, "Evil‮Name", "zero‍width", "bell\x07", 42])
def test_display_name_rejects_long_control_or_non_string(value: object):
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"displayName": value})


def test_headline_limit():
    assert ProfilePatch(headline="Senior React developer").headline == "Senior React developer"
    with pytest.raises(ValidationError):
        ProfilePatch(headline="x" * 121)


@pytest.mark.parametrize(
    ("key", "url"),
    [
        ("linkedin", "https://www.linkedin.com/in/linh"),
        ("linkedin", "https://linkedin.com/in/linh"),
        ("github", "https://github.com/linh"),
        ("website", "https://linh.dev/portfolio?x=1"),
    ],
)
def test_valid_links(key: str, url: str):
    body = ProfilePatch.model_validate({"links": {key: url}})
    assert getattr(body.links, key) == url


@pytest.mark.parametrize(
    ("key", "url"),
    [
        ("website", "http://linh.dev"),
        ("website", "javascript:alert(1)"),
        ("website", "https://"),
        ("website", "https://localhost"),
        ("website", "https://user:pw@linh.dev"),
        ("website", "https://linh.dev/a b"),
        ("website", "https://linh.dev/" + "a" * 300),
        ("linkedin", "https://evil.com/in/linh"),
        ("linkedin", "https://notlinkedin.com/in/linh"),
        ("github", "https://github.com.evil.com/linh"),
        ("github", "data:text/html,hi"),
    ],
)
def test_invalid_links(key: str, url: str):
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"links": {key: url}})


def test_empty_link_clears_and_unknown_link_key_is_rejected():
    body = ProfilePatch.model_validate({"links": {"github": ""}})
    assert body.links is not None
    assert body.links.github is None
    assert body.links.model_fields_set == {"github"}
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"links": {"twitter": "https://x.com/a"}})


def test_unknown_top_level_key_is_rejected():
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"email": "someone@else.com"})


def test_country_is_normalised_and_validated():
    assert ProfilePatch(candidateCountry="vn").candidateCountry == "VN"
    assert ProfilePatch.model_validate({"candidateCountry": ""}).candidateCountry is None
    with pytest.raises(ValidationError):
        ProfilePatch(candidateCountry="Vietnam")


def test_time_zone_must_be_iana_and_not_null():
    assert ProfilePatch(timeZone="Australia/Sydney").timeZone == "Australia/Sydney"
    with pytest.raises(ValidationError):
        ProfilePatch(timeZone="Mars/Olympus")
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"timeZone": None})


def test_keywords_are_trimmed_deduplicated_and_bounded():
    assert ProfilePatch(keywords=[" React ", "react", "Go"]).keywords == ["React", "Go"]
    with pytest.raises(ValidationError):
        ProfilePatch(keywords=["x" * 41])
    with pytest.raises(ValidationError):
        ProfilePatch(keywords=[str(i) for i in range(31)])
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"keywords": None})
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"remoteOnly": None})
