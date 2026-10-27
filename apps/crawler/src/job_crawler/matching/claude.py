"""Run `claude -p` headless with structured JSON output (from the jobflow POC, made synchronous).

No tools (or only Read, for OCR of a copied file), no MCP, no user/project settings, no session
persistence, and a throwaway working directory so no CLAUDE.md is picked up.
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

CLAUDE_BIN = os.environ.get("UJC_CLAUDE_BIN", "claude")
MODEL = os.environ.get("UJC_CLAUDE_MODEL", "sonnet")
TIMEOUT_S = int(os.environ.get("UJC_CLAUDE_TIMEOUT_S", "300"))


class ClaudeError(Exception):
    pass


def run_claude(
    prompt: str, *, system: str, schema: dict[str, Any], files: list[Path] | None = None
) -> dict[str, Any]:
    args = [
        CLAUDE_BIN, "-p",
        "--model", MODEL,
        "--output-format", "json",
        "--json-schema", json.dumps(schema),
        "--system-prompt", system,
        "--tools", "Read" if files else "",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--no-session-persistence",
    ]  # fmt: skip
    if files:
        args += ["--allowedTools", "Read"]
    with tempfile.TemporaryDirectory(prefix="ujc-claude-") as cwd:
        for f in files or []:
            shutil.copy(f, Path(cwd) / f.name)
        try:
            proc = subprocess.run(
                args, input=prompt.encode(), cwd=cwd, capture_output=True, timeout=TIMEOUT_S
            )
        except FileNotFoundError as e:
            raise ClaudeError(f"claude CLI not found ({CLAUDE_BIN}): install Claude Code") from e
        except subprocess.TimeoutExpired as e:
            raise ClaudeError("claude CLI timed out") from e
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        detail = (proc.stderr or proc.stdout).decode(errors="replace")[-300:]
        raise ClaudeError(f"claude CLI exit {proc.returncode}: {detail}") from e
    if data.get("is_error") or not isinstance(data.get("structured_output"), dict):
        raise ClaudeError(f"claude CLI error: {str(data.get('result'))[:300]}")
    log.info("claude done in %s ms", data.get("duration_ms"))
    return data["structured_output"]
