import stat

from job_crawler.runner.config import RunnerConfig, forget_config, load_config, save_config

CONFIG = RunnerConfig(server="https://host.test", runner_id="7", token="ujc_run_secret")


def test_save_then_load_round_trips(tmp_path):
    path = tmp_path / "runner.json"
    saved_path = save_config(CONFIG, path)
    assert saved_path == path

    loaded = load_config(path)
    assert loaded == CONFIG


def test_saved_config_is_mode_0600(tmp_path):
    path = tmp_path / "runner.json"
    save_config(CONFIG, path)
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600


def test_token_is_never_in_plain_sight_in_the_directory_listing(tmp_path):
    path = tmp_path / "nested" / "runner.json"
    save_config(CONFIG, path)
    assert path.is_file()
    assert path.parent.is_dir()


def test_load_missing_config_returns_none(tmp_path):
    assert load_config(tmp_path / "missing.json") is None


def test_forget_deletes_the_file(tmp_path):
    path = tmp_path / "runner.json"
    save_config(CONFIG, path)
    assert forget_config(path) is True
    assert not path.exists()
    assert forget_config(path) is False
