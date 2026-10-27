"""Claude review of prefiltered (CV, job) pairs, several jobs per `claude -p` call."""

import json
from dataclasses import dataclass
from typing import Any

from job_crawler.matching.claude import ClaudeError, run_claude
from job_crawler.matching.prompts import MATCH_SCHEMA, MATCH_SYSTEM

MAX_JD_CHARS = 6000


@dataclass(slots=True)
class StoredJob:
    """A job row as the matcher needs it."""

    id: int
    title: str
    company: str
    location: str | None
    remote: bool
    open_to: list[str] | None
    salary_text: str | None
    employment_type: str | None
    tags: list[str]
    description: str


@dataclass(slots=True)
class MatchResult:
    job_id: int
    score: int
    summary: str
    reasons: list[str]
    missing_skills: list[str]


def job_block(job: StoredJob) -> str:
    desc = job.description[:MAX_JD_CHARS] or "(No description available, only the title.)"
    open_to = ", ".join(job.open_to) if job.open_to else "unknown"
    return (
        f'<job id="{job.id}">\n'
        f"Title: {job.title}\nCompany: {job.company or 'undisclosed'}\n"
        f"Location: {job.location or 'unknown'} ({'remote' if job.remote else 'on-site/hybrid'})\n"
        f"Remote candidates accepted from: {open_to}\n"
        f"Type: {job.employment_type or 'unknown'}\nSalary: {job.salary_text or 'not stated'}\n"
        f"Tags: {', '.join(job.tags) or '-'}\n\n{desc}\n</job>"
    )


def candidate_block(profile: dict[str, Any], preferences: str) -> str:
    return (
        f"<candidate>\n{json.dumps(profile, ensure_ascii=False, indent=1)}\n"
        f"Preferences: {preferences.strip() or 'none'}\n</candidate>"
    )


def parse_results(out: dict[str, Any], jobs: list[StoredJob]) -> list[MatchResult]:
    wanted = {j.id for j in jobs}
    results: list[MatchResult] = []
    for r in out.get("results", []):
        if r.get("job_id") not in wanted:
            continue  # hallucinated or duplicated id
        wanted.discard(r["job_id"])
        results.append(
            MatchResult(
                job_id=r["job_id"],
                score=max(0, min(100, int(r.get("score", 0)))),
                summary=str(r.get("summary", "")).strip(),
                reasons=[str(x).strip() for x in r.get("reasons", []) if str(x).strip()][:6],
                missing_skills=[str(x).strip()[:120] for x in r.get("missing_skills", [])][:8],
            )
        )
    return results


def score_jobs(
    profile: dict[str, Any], preferences: str, jobs: list[StoredJob]
) -> list[MatchResult]:
    prompt = candidate_block(profile, preferences) + "\n\n" + "\n\n".join(map(job_block, jobs))
    results = parse_results(run_claude(prompt, system=MATCH_SYSTEM, schema=MATCH_SCHEMA), jobs)
    if not results:
        raise ClaudeError("match response had no usable results")
    return results
