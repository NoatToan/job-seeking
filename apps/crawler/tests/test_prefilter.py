from dataclasses import dataclass, field

from job_crawler.matching.prefilter import score, top_candidates

PROFILE = {
    "seniority": "senior",
    "skills": ["Python", "FastAPI", "PostgreSQL", "Kubernetes", "C++"],
    "target_titles": ["Senior Backend Engineer"],
    "search_keywords": ["python", "backend"],
}


@dataclass
class J:
    title: str
    tags: list[str] = field(default_factory=list)
    description: str = ""


def test_relevant_job_scores_higher() -> None:
    good = J("Senior Backend Engineer (Python)", ["Python", "PostgreSQL"], "FastAPI on Kubernetes")
    meh = J("Data Analyst", [], "Some SQL and Python scripting")
    bad = J("Sales Manager", [], "Grow revenue")
    assert score(PROFILE, good) > score(PROFILE, meh) > score(PROFILE, bad)


def test_seniority_mismatch_penalised() -> None:
    assert score(PROFILE, J("Junior Python Developer")) < score(PROFILE, J("Python Developer"))


def test_symbols_in_skill_names() -> None:
    assert score(PROFILE, J("Engineer", description="modern C++ and python")) > score(
        PROFILE, J("Engineer", description="modern C and python")
    )


def test_top_candidates_limits_and_orders() -> None:
    jobs = [J("Sales"), J("Backend Engineer"), J("Senior Backend Engineer", ["Python", "FastAPI"])]
    top = top_candidates(PROFILE, jobs, limit=2)
    assert [j.title for j, _ in top] == ["Senior Backend Engineer", "Backend Engineer"]
