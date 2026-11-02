"""Local runner config: `~/.unified-job-crawler/runner.json` (override with `UJC_RUNNER_CONFIG`),
written mode 0600. Holds the paired server URL, runner id and bearer token. The token is never
logged or printed back out after pairing."""

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CONFIG_PATH = Path.home() / ".unified-job-crawler" / "runner.json"


def config_path() -> Path:
    override = os.environ.get("UJC_RUNNER_CONFIG")
    return Path(override) if override else DEFAULT_CONFIG_PATH


@dataclass(frozen=True)
class RunnerConfig:
    server: str
    runner_id: str
    token: str

    def to_dict(self) -> dict:
        return {"server": self.server, "runnerId": self.runner_id, "token": self.token}


def load_config(path: Path | None = None) -> RunnerConfig | None:
    path = path or config_path()
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return RunnerConfig(server=data["server"], runner_id=data["runnerId"], token=data["token"])


def save_config(config: RunnerConfig, path: Path | None = None) -> Path:
    path = path or config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config.to_dict(), indent=2), encoding="utf-8")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600: only this user can read the token
    return path


def forget_config(path: Path | None = None) -> bool:
    path = path or config_path()
    if not path.is_file():
        return False
    path.unlink()
    return True
