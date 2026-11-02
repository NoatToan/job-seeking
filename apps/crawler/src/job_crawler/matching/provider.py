"""Pluggable LLM provider (M4-01, minimal): one `run()` call every matching function goes
through, so tests and a future server-side Anthropic API key never need the `claude` CLI.

Chosen via `UJC_LLM_PROVIDER` (`claude_cli` default | `fake` | `anthropic`, see
`AnthropicApiProvider`).
"""

import base64
import os
import re
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from job_crawler.matching.claude import run_claude


@runtime_checkable
class LLMProvider(Protocol):
    def run(
        self, prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
    ) -> dict[str, Any]: ...


class ClaudeCliProvider:
    """Wraps the existing `claude -p` subprocess call (job_crawler.matching.claude.run_claude)."""

    def run(
        self, prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
    ) -> dict[str, Any]:
        return run_claude(prompt, system=system, schema=schema, files=files)


class AnthropicProviderError(Exception):
    """Raised for any Anthropic API failure (auth, rate limit, or otherwise)."""


_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

_TOOL_NAME = "respond"


def _file_block(path: Path) -> dict[str, Any]:
    media_type = _MEDIA_TYPES.get(path.suffix.lower())
    if media_type is None:
        raise AnthropicProviderError(f"unsupported file type for Anthropic input: {path.suffix}")
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    kind = "document" if media_type == "application/pdf" else "image"
    return {"type": kind, "source": {"type": "base64", "media_type": media_type, "data": data}}


def _user_content(prompt: str, files: list[Path] | None) -> list[dict[str, Any]]:
    # Files first, then the text — matches the CLI provider's "Read the file, then answer".
    return [_file_block(f) for f in files or []] + [{"type": "text", "text": prompt}]


class AnthropicApiProvider:
    """Calls Claude through the official `anthropic` Python SDK instead of shelling out to the
    `claude` CLI, so the server doesn't need a Claude Code login (`UJC_LLM_PROVIDER=anthropic`).

    Structured output: a single forced tool call (`tool_choice={"type": "tool", ...}`) whose
    `input_schema` is the caller's JSON schema (`strict: True`); the validated `input` dict of
    that tool call is returned directly, so there's no JSON-in-text parsing. PDFs/images in
    `files` are sent as `document`/`image` base64 content blocks (for OCR-style prompts).
    Retries on 429/5xx are handled by the SDK's own default `max_retries`.

    `client` is normally left `None`: a real `anthropic.Anthropic()` is created lazily on first
    use (reads `ANTHROPIC_API_KEY` from the environment; never logged). Tests inject a fake
    object exposing `.messages.create(...)` instead, so no `anthropic` import or network call is
    needed to exercise schema parsing or error mapping — `anthropic` stays an optional
    dependency (`uv sync --extra api`) for the server path alone.
    """

    def __init__(self, client: Any | None = None, *, model: str | None = None) -> None:
        self._client = client
        self._model = model or os.environ.get("UJC_ANTHROPIC_MODEL", "claude-sonnet-5")
        self._max_tokens = int(os.environ.get("UJC_ANTHROPIC_MAX_TOKENS", "4096"))

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import anthropic
            except ImportError as e:
                raise AnthropicProviderError(
                    "the `anthropic` package is not installed — run `uv sync --extra api`"
                ) from e
            self._client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from the environment only
        return self._client

    def run(
        self, prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
    ) -> dict[str, Any]:
        client = self._get_client()
        tool = {
            "name": _TOOL_NAME,
            "description": "Return the structured result matching the given JSON schema.",
            "input_schema": schema,
            "strict": True,
        }
        try:
            response = client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                tools=[tool],
                tool_choice={"type": "tool", "name": _TOOL_NAME},
                messages=[{"role": "user", "content": _user_content(prompt, files)}],
            )
        except Exception as exc:
            # Duck-typed on `status_code` (present on the real SDK's `APIStatusError` family
            # and on fake clients in tests alike) rather than `except anthropic.*Error`, so
            # error mapping doesn't require importing `anthropic` either.
            status = getattr(exc, "status_code", None)
            if status == 401:
                raise AnthropicProviderError(f"Anthropic API key rejected (401): {exc}") from exc
            if status == 429:
                raise AnthropicProviderError(f"Anthropic rate limited (429): {exc}") from exc
            raise AnthropicProviderError(f"Anthropic API error: {exc}") from exc
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == _TOOL_NAME:
                return dict(block.input)
        raise AnthropicProviderError("Anthropic response had no forced tool_use block")


_JOB_ID_RE = re.compile(r'<job id="(\d+)">')


def _default_for_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """A minimal value satisfying `schema`'s declared properties, so any prompt/schema pair gets
    a shape-valid (if empty) response without a per-test stub."""
    out: dict[str, Any] = {}
    for key, spec in schema.get("properties", {}).items():
        t = spec.get("type")
        if t == "array":
            out[key] = []
        elif t in ("number", "integer"):
            out[key] = 0
        elif t == "boolean":
            out[key] = False
        else:
            out[key] = ""
    return out


class FakeProvider:
    """Deterministic, no-network, no-subprocess provider (`UJC_LLM_PROVIDER=fake`): every test
    that exercises matching code goes through this instead of the real `claude` CLI.

    For the match-scoring schema it scores every `<job id="...">` block found in the prompt
    (score 75, a generic summary/reason, no missing skills) so a full match_score run has
    something to store. For every other schema (CV text/profile extraction) it returns a minimal
    value satisfying the schema. Pass `responses` to queue specific payloads instead (one per
    call, in order) for tests that need to control the output.
    """

    def __init__(self, responses: list[dict[str, Any]] | None = None):
        self._queue: list[dict[str, Any]] = list(responses or [])

    def run(
        self, prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
    ) -> dict[str, Any]:
        if self._queue:
            return self._queue.pop(0)
        if "results" in schema.get("properties", {}):
            job_ids = [int(m) for m in _JOB_ID_RE.findall(prompt)]
            return {
                "results": [
                    {
                        "job_id": job_id,
                        "score": 75,
                        "summary": "Fake match summary.",
                        "reasons": ["Fake reason"],
                        "missing_skills": [],
                    }
                    for job_id in job_ids
                ]
            }
        return _default_for_schema(schema)


def get_provider() -> LLMProvider:
    name = os.environ.get("UJC_LLM_PROVIDER", "claude_cli").strip().lower()
    if name == "fake":
        return FakeProvider()
    if name == "anthropic":
        return AnthropicApiProvider()
    return ClaudeCliProvider()
