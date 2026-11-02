import pytest

from job_crawler.matching.prompts import CV_PROFILE_SCHEMA, MATCH_SCHEMA, OCR_SCHEMA
from job_crawler.matching.provider import (
    AnthropicApiProvider,
    ClaudeCliProvider,
    FakeProvider,
    get_provider,
)


def test_get_provider_defaults_to_claude_cli(monkeypatch):
    monkeypatch.delenv("UJC_LLM_PROVIDER", raising=False)
    assert isinstance(get_provider(), ClaudeCliProvider)


def test_get_provider_reads_env(monkeypatch):
    monkeypatch.setenv("UJC_LLM_PROVIDER", "fake")
    assert isinstance(get_provider(), FakeProvider)


def test_anthropic_provider_is_not_implemented_yet():
    with pytest.raises(NotImplementedError):
        AnthropicApiProvider().run("hi", system="s", schema=OCR_SCHEMA)


def test_fake_provider_fills_ocr_and_cv_schema():
    provider = FakeProvider()
    assert provider.run("hi", system="s", schema=OCR_SCHEMA) == {"text": ""}
    profile = provider.run("hi", system="s", schema=CV_PROFILE_SCHEMA)
    assert profile["skills"] == []
    assert profile["years_experience"] == 0


def test_fake_provider_scores_every_job_id_in_the_prompt():
    prompt = '<job id="1">a</job>\n<job id="42">b</job>'
    out = FakeProvider().run(prompt, system="s", schema=MATCH_SCHEMA)
    assert [r["job_id"] for r in out["results"]] == [1, 42]
    assert all(r["score"] == 75 for r in out["results"])


def test_fake_provider_queued_responses_take_priority():
    provider = FakeProvider(responses=[{"text": "queued"}])
    assert provider.run("x", system="s", schema=OCR_SCHEMA) == {"text": "queued"}
    # queue drained: falls back to the schema default
    assert provider.run("x", system="s", schema=OCR_SCHEMA) == {"text": ""}
