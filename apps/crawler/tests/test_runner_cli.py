import json

import pytest

import job_crawler.runner.__main__ as runner_cli
from job_crawler.models import JobRecord
from job_crawler.runner.config import load_config
from job_crawler.session import __main__ as session_main


@pytest.fixture(autouse=True)
def _runner_config_in_tmp(tmp_path, monkeypatch):
    monkeypatch.setenv("UJC_RUNNER_CONFIG", str(tmp_path / "runner.json"))
    yield


class _FakeRunnerClient:
    """Stands in for `RunnerClient`: records every call, no real HTTP (httpx is covered in
    test_runner_client.py)."""

    instances: list["_FakeRunnerClient"] = []

    def __init__(self, server, token=None, *, transport=None):  # noqa: ARG002
        self.server = server
        self.token = token
        self.pair_calls: list[tuple[str, str]] = []
        self.upload_calls: list[tuple[str, list[dict]]] = []
        self.pair_result = {"runnerId": "42", "token": "ujc_run_faketoken"}
        self.plan_result = {
            "keywords": ["react", "node"],
            "remoteOnly": True,
            "sites": ["linkedin"],
        }
        self.upload_result = {"received": 1, "upserted": 1}
        _FakeRunnerClient.instances.append(self)

    def pair(self, code, name):
        self.pair_calls.append((code, name))
        return self.pair_result

    def plan(self):
        return self.plan_result

    def upload_jobs(self, site, jobs):
        self.upload_calls.append((site, jobs))
        return self.upload_result

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture(autouse=True)
def _fake_client(monkeypatch):
    _FakeRunnerClient.instances = []
    monkeypatch.setattr(runner_cli, "RunnerClient", _FakeRunnerClient)
    yield


def test_pair_writes_config_and_never_prints_the_token(capsys):
    rc = runner_cli.main(
        ["pair", "--api", "https://host.test", "--code", "ABCD-EFGH", "--name", "Mac"]
    )
    assert rc == 0

    config = load_config()
    assert config is not None
    assert config.server == "https://host.test"
    assert config.runner_id == "42"
    assert config.token == "ujc_run_faketoken"

    out = capsys.readouterr().out
    assert "ujc_run_faketoken" not in out
    assert _FakeRunnerClient.instances[0].pair_calls == [("ABCD-EFGH", "Mac")]


def test_status_without_pairing(capsys):
    rc = runner_cli.main(["status"])
    assert rc == 0
    assert "Not paired" in capsys.readouterr().out


def test_status_after_pairing(capsys):
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])
    capsys.readouterr()
    rc = runner_cli.main(["status"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "runner 42" in out
    assert "ujc_run_faketoken" not in out


def test_run_without_pairing_fails(capsys):
    rc = runner_cli.main(["run"])
    assert rc == 2
    assert "Not paired" in capsys.readouterr().err


def test_forget_without_confirmation_cancels(monkeypatch):
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])
    monkeypatch.setattr("builtins.input", lambda _: "n")
    rc = runner_cli.main(["forget"])
    assert rc == 1
    assert load_config() is not None


def test_forget_with_yes_flag_deletes_config():
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])
    rc = runner_cli.main(["forget", "--yes"])
    assert rc == 0
    assert load_config() is None


_FAKE_JOB = JobRecord(
    source="linkedin",
    external_id="1",
    url="https://www.linkedin.com/jobs/view/1/",
    title="Senior Backend Engineer",
    company="Acme",
)


def test_run_fetches_plan_crawls_and_uploads_without_cookies_or_html(monkeypatch, capsys):
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])

    calls = []

    def fake_crawl_site(site, profiles, pages, headless):
        calls.append((site.id, [p.keywords for p in profiles], pages, headless))
        return {profiles[0].id: [_FAKE_JOB]}, None

    monkeypatch.setattr(session_main, "crawl_site", fake_crawl_site)

    rc = runner_cli.main(["run", "--pages", "3"])
    assert rc == 0

    assert calls == [("linkedin", ["react OR node"], 3, True)]  # headless by default

    client = _FakeRunnerClient.instances[-1]
    assert len(client.upload_calls) == 1
    site, jobs_sent = client.upload_calls[0]
    assert site == "linkedin"
    assert len(jobs_sent) == 1
    uploaded = jobs_sent[0]
    assert uploaded["title"] == "Senior Backend Engineer"
    # the runner never sends cookies, HTML pages or screenshots: `raw` is never in the payload.
    assert "raw" not in uploaded
    serialized = json.dumps(jobs_sent)
    assert "cookie" not in serialized.lower()
    assert "<html" not in serialized.lower()

    out = capsys.readouterr().out
    assert "1 jobs found, 1 new" in out


def test_run_with_headed_flag_passes_headless_false(monkeypatch):
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])

    calls = []

    def fake_crawl_site(site, profiles, pages, headless):
        calls.append(headless)
        return {}, None

    monkeypatch.setattr(session_main, "crawl_site", fake_crawl_site)
    runner_cli.main(["run", "--headed"])
    assert calls == [False]


def test_run_chunks_uploads_at_200_jobs(monkeypatch):
    runner_cli.main(["pair", "--api", "https://host.test", "--code", "ABCD-EFGH"])

    many_jobs = [
        JobRecord(
            source="linkedin",
            external_id=str(i),
            url=f"https://www.linkedin.com/jobs/view/{i}/",
            title="Engineer",
            company="Acme",
        )
        for i in range(250)
    ]

    def fake_crawl_site(site, profiles, pages, headless):  # noqa: ARG001
        return {profiles[0].id: many_jobs}, None

    monkeypatch.setattr(session_main, "crawl_site", fake_crawl_site)
    runner_cli.main(["run"])

    client = _FakeRunnerClient.instances[-1]
    chunk_sizes = [len(jobs) for _, jobs in client.upload_calls]
    assert chunk_sizes == [200, 50]
