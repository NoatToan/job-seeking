from job_crawler.models import JobRecord

from ujc_api.runner_validation import (
    InvalidJob,
    TooManyJobs,
    UnknownSite,
    validate_runner_jobs,
)

_LINKEDIN_JOB = {
    "external_id": "123",
    "url": "https://www.linkedin.com/jobs/view/123/",
    "title": "Senior Backend Engineer",
    "company": "Acme",
}


def test_valid_jobs_are_returned_as_job_records():
    records = validate_runner_jobs("linkedin", [_LINKEDIN_JOB])
    assert len(records) == 1
    assert isinstance(records[0], JobRecord)
    assert records[0].source == "linkedin"
    assert records[0].raw == {}


def test_raw_page_data_is_stripped():
    job = {**_LINKEDIN_JOB, "raw": {"card_text": "sensitive page html"}}
    records = validate_runner_jobs("linkedin", [job])
    assert records[0].raw == {}


def test_unknown_site_is_rejected():
    try:
        validate_runner_jobs("seek", [_LINKEDIN_JOB])
        raise AssertionError("expected UnknownSite")
    except UnknownSite:
        pass


def test_too_many_jobs_is_rejected():
    jobs = [{**_LINKEDIN_JOB, "external_id": str(i)} for i in range(201)]
    try:
        validate_runner_jobs("linkedin", jobs)
        raise AssertionError("expected TooManyJobs")
    except TooManyJobs:
        pass


def test_exactly_the_limit_is_accepted():
    jobs = [{**_LINKEDIN_JOB, "external_id": str(i)} for i in range(200)]
    assert len(validate_runner_jobs("linkedin", jobs)) == 200


def test_source_mismatch_is_rejected():
    job = {**_LINKEDIN_JOB, "source": "glassdoor"}
    try:
        validate_runner_jobs("linkedin", [job])
        raise AssertionError("expected InvalidJob")
    except InvalidJob as exc:
        assert exc.index == 0


def test_foreign_host_is_rejected():
    job = {**_LINKEDIN_JOB, "url": "https://evil.example.com/jobs/view/123/"}
    try:
        validate_runner_jobs("linkedin", [job])
        raise AssertionError("expected InvalidJob")
    except InvalidJob:
        pass


def test_host_subdomain_is_allowed():
    job = {**_LINKEDIN_JOB, "url": "https://www.linkedin.com/jobs/view/123/"}
    assert len(validate_runner_jobs("linkedin", [job])) == 1


def test_malformed_job_is_rejected():
    job = {"external_id": "1", "url": "https://www.linkedin.com/jobs/view/1/"}  # missing title
    try:
        validate_runner_jobs("linkedin", [job])
        raise AssertionError("expected InvalidJob")
    except InvalidJob:
        pass
