from job_crawler.db import ERROR_MAX_LEN, dedupe, truncate_error
from job_crawler.models import JobRecord


def _job(source: str, external_id: str, title: str) -> JobRecord:
    return JobRecord(
        source=source,
        external_id=external_id,
        url=f"https://example.test/{external_id}",
        title=title,
        company="Acme",
    )


def test_dedupe_keeps_last_per_source_and_id():
    jobs = [
        _job("lever", "a", "first"),
        _job("lever", "b", "other"),
        _job("greenhouse", "a", "same id, other source"),
        _job("lever", "a", "second"),
    ]
    result = dedupe(jobs)
    assert [(j.source, j.external_id, j.title) for j in result] == [
        ("lever", "a", "second"),
        ("lever", "b", "other"),
        ("greenhouse", "a", "same id, other source"),
    ]


def test_dedupe_empty():
    assert dedupe([]) == []


def test_truncate_error():
    assert truncate_error(None) is None
    assert truncate_error("") is None
    assert truncate_error("boom") == "boom"
    exact = "x" * ERROR_MAX_LEN
    assert truncate_error(exact) == exact
    long = truncate_error("y" * (ERROR_MAX_LEN + 50))
    assert long is not None
    assert len(long) == ERROR_MAX_LEN
    assert long.endswith("...")
