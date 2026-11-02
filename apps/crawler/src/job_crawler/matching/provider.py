"""Pluggable LLM provider (M4-01, minimal): one `run()` call every matching function goes
through, so tests and a future server-side Anthropic API key never need the `claude` CLI.

Chosen via `UJC_LLM_PROVIDER` (`claude_cli` default | `fake`; `anthropic` is a documented
follow-up, see `AnthropicApiProvider`).
"""

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


class AnthropicApiProvider:
    """Follow-up (M4-01 full scope): call the Anthropic API directly (official `anthropic` SDK)
    instead of shelling out to the `claude` CLI, so the server doesn't need a Claude Code login.
    Not implemented in this minimal pass — see docs/product/backlog.json M4-01."""

    def run(
        self, prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
    ) -> dict[str, Any]:
        raise NotImplementedError(
            "AnthropicApiProvider (UJC_LLM_PROVIDER=anthropic) is not implemented yet — a "
            "follow-up to M4-01. Use UJC_LLM_PROVIDER=claude_cli or =fake."
        )


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
