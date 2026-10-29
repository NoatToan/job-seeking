from ujc_api.settings import Settings, _dotenv_path


def test_defaults_without_any_env_vars(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("UJC_ENV", raising=False)
    monkeypatch.delenv("UJC_LOG_LEVEL", raising=False)
    settings = Settings(_env_file=None)
    assert settings.ujc_env == "development"
    assert settings.ujc_log_level == "INFO"
    assert settings.database_url


def test_reads_values_from_the_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h:5432/db")
    monkeypatch.setenv("UJC_ENV", "production")
    monkeypatch.setenv("UJC_LOG_LEVEL", "WARNING")
    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql://u:p@h:5432/db"
    assert settings.ujc_env == "production"
    assert settings.ujc_log_level == "WARNING"


def test_dotenv_path_is_used_in_development(tmp_path, monkeypatch):
    (tmp_path / ".env.local").write_text("DATABASE_URL=postgresql://from-dotenv/db\n")
    monkeypatch.delenv("UJC_ENV", raising=False)
    assert _dotenv_path(tmp_path) == tmp_path / ".env.local"


def test_dotenv_path_is_none_outside_development(tmp_path, monkeypatch):
    (tmp_path / ".env.local").write_text("DATABASE_URL=postgresql://from-dotenv/db\n")
    for env in ("test", "production"):
        monkeypatch.setenv("UJC_ENV", env)
        assert _dotenv_path(tmp_path) is None


def test_dotenv_path_is_none_when_the_file_is_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("UJC_ENV", raising=False)
    assert _dotenv_path(tmp_path) is None
