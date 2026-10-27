from pathlib import Path

from job_crawler.matching import cv, scorer

FIXTURES = Path(__file__).parent / "fixtures"


def _job(job_id: int, **kw) -> scorer.StoredJob:
    base = dict(
        title="Senior Next.js Engineer",
        company="Acme",
        location="Worldwide",
        remote=True,
        open_to=["WORLDWIDE"],
        salary_text=None,
        employment_type="Full Time",
        tags=["Next.js"],
        description="Build Next.js apps.",
    )
    return scorer.StoredJob(id=job_id, **{**base, **kw})


def test_pdf_text_layer_is_read_without_ocr():
    text = cv.extract_text(FIXTURES / "sample_cv.pdf")
    assert not text.ocr_used
    assert "Senior Backend Engineer" in text.text and "PostgreSQL" in text.text


def test_unsupported_file_type(tmp_path):
    f = tmp_path / "cv.docx"
    f.write_bytes(b"PK")
    try:
        cv.extract_text(f)
    except cv.UnsupportedFileError:
        pass
    else:
        raise AssertionError("expected UnsupportedFileError")


def test_job_block_mentions_who_may_apply():
    block = scorer.job_block(_job(7, open_to=["US"], description=""))
    assert '<job id="7">' in block and "accepted from: US" in block
    assert "No description available" in block


def test_parse_results_drops_unknown_ids_and_clamps():
    jobs = [_job(1), _job(2)]
    out = {
        "results": [
            {
                "job_id": 1,
                "score": 140,
                "summary": " Rất hợp ",
                "reasons": ["a", " "],
                "missing_skills": [],
            },
            {"job_id": 99, "score": 50, "summary": "x", "reasons": [], "missing_skills": []},
            {"job_id": 1, "score": 10, "summary": "dup", "reasons": [], "missing_skills": []},
        ]
    }
    (r,) = scorer.parse_results(out, jobs)
    assert (r.job_id, r.score, r.summary, r.reasons) == (1, 100, "Rất hợp", ["a"])
