import sys
from pathlib import Path

import pytest

from job_crawler.matching.prompts import CV_PROFILE_SCHEMA, MATCH_SCHEMA, OCR_SCHEMA
from job_crawler.matching.provider import (
    AnthropicApiProvider,
    AnthropicProviderError,
    ClaudeCliProvider,
    FakeProvider,
    get_provider,
)

FIXTURES = Path(__file__).parent / "fixtures"


def test_get_provider_defaults_to_claude_cli(monkeypatch):
    monkeypatch.delenv("UJC_LLM_PROVIDER", raising=False)
    assert isinstance(get_provider(), ClaudeCliProvider)


def test_get_provider_reads_env(monkeypatch):
    monkeypatch.setenv("UJC_LLM_PROVIDER", "fake")
    assert isinstance(get_provider(), FakeProvider)


def test_get_provider_reads_env_anthropic(monkeypatch):
    monkeypatch.setenv("UJC_LLM_PROVIDER", "anthropic")
    assert isinstance(get_provider(), AnthropicApiProvider)


# --- AnthropicApiProvider: a fake `.messages.create(...)` client, never the real `anthropic`
# package or any network call (matches this repo's "no network in tests" rule). ------------


class _Block:
    def __init__(self, type_, **kw):
        self.type = type_
        self.__dict__.update(kw)


class _Response:
    def __init__(self, content):
        self.content = content


class _StatusError(Exception):
    def __init__(self, message, status_code):
        super().__init__(message)
        self.status_code = status_code


class _FakeMessages:
    def __init__(self, response=None, exc=None):
        self._response = response
        self._exc = exc
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._exc:
            raise self._exc
        return self._response


class _FakeClient:
    def __init__(self, response=None, exc=None):
        self.messages = _FakeMessages(response, exc)


def _tool_use_response(input_dict):
    return _Response([_Block("tool_use", name="respond", input=input_dict)])


def test_anthropic_provider_returns_forced_tool_input():
    client = _FakeClient(response=_tool_use_response({"text": "hello"}))
    provider = AnthropicApiProvider(client=client)
    assert provider.run("hi", system="s", schema=OCR_SCHEMA) == {"text": "hello"}

    call = client.messages.calls[0]
    assert call["model"] == "claude-sonnet-5"
    assert call["tool_choice"] == {"type": "tool", "name": "respond"}
    assert call["tools"][0]["input_schema"] == OCR_SCHEMA
    assert call["tools"][0]["strict"] is True
    assert call["messages"][0]["content"] == [{"type": "text", "text": "hi"}]


def test_anthropic_provider_reads_model_from_env(monkeypatch):
    monkeypatch.setenv("UJC_ANTHROPIC_MODEL", "claude-opus-5")
    client = _FakeClient(response=_tool_use_response({"text": ""}))
    AnthropicApiProvider(client=client).run("hi", system="s", schema=OCR_SCHEMA)
    assert client.messages.calls[0]["model"] == "claude-opus-5"


def test_anthropic_provider_sends_pdf_as_document_block():
    client = _FakeClient(response=_tool_use_response({"text": ""}))
    provider = AnthropicApiProvider(client=client)
    provider.run("hi", system="s", schema=OCR_SCHEMA, files=[FIXTURES / "sample_cv.pdf"])

    content = client.messages.calls[0]["messages"][0]["content"]
    assert content[0]["type"] == "document"
    assert content[0]["source"]["media_type"] == "application/pdf"
    assert content[0]["source"]["type"] == "base64"
    assert content[-1] == {"type": "text", "text": "hi"}


def test_anthropic_provider_sends_image_as_image_block(tmp_path):
    png = tmp_path / "scan.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\nfake-bytes")
    client = _FakeClient(response=_tool_use_response({"text": ""}))
    AnthropicApiProvider(client=client).run("hi", system="s", schema=OCR_SCHEMA, files=[png])

    content = client.messages.calls[0]["messages"][0]["content"]
    assert content[0] == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": __import__("base64").standard_b64encode(png.read_bytes()).decode("ascii"),
        },
    }


def test_anthropic_provider_401_raises_with_message():
    client = _FakeClient(exc=_StatusError("invalid x-api-key", 401))
    with pytest.raises(AnthropicProviderError, match="401"):
        AnthropicApiProvider(client=client).run("hi", system="s", schema=OCR_SCHEMA)


def test_anthropic_provider_429_raises_with_message():
    client = _FakeClient(exc=_StatusError("rate limited", 429))
    with pytest.raises(AnthropicProviderError, match="429"):
        AnthropicApiProvider(client=client).run("hi", system="s", schema=OCR_SCHEMA)


def test_anthropic_provider_missing_tool_use_block_raises():
    client = _FakeClient(response=_Response([_Block("text", text="oops, no tool call")]))
    with pytest.raises(AnthropicProviderError, match="tool_use"):
        AnthropicApiProvider(client=client).run("hi", system="s", schema=OCR_SCHEMA)


def test_anthropic_provider_without_client_needs_the_optional_dependency(monkeypatch):
    # No `client=` given and `anthropic` isn't importable (simulated here regardless of
    # whether the optional `api` extra happens to be installed in this environment) -> a
    # clear, actionable error, not a raw ImportError.
    monkeypatch.setitem(sys.modules, "anthropic", None)
    with pytest.raises(AnthropicProviderError, match="uv sync --extra api"):
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
