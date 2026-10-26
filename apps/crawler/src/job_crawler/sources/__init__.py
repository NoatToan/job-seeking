from collections.abc import Callable
from types import ModuleType

from job_crawler.http import HttpClient
from job_crawler.models import Board, SkipSource, SourceResult
from job_crawler.sources import adzuna, ashby, greenhouse, himalayas, lever, weworkremotely

FetchFn = Callable[[HttpClient, list[Board]], SourceResult]

_MODULES: list[ModuleType] = [weworkremotely, greenhouse, lever, ashby, himalayas, adzuna]
SOURCES: dict[str, FetchFn] = {m.SOURCE: m.fetch for m in _MODULES}

# Sources whose boards come from the `company_boards` table.
ATS_SOURCES = {"greenhouse", "lever", "ashby"}

# Used in --dry-run (no DB): a subset of the seed rows in db/migrations/001_init.sql.
DEFAULT_BOARDS: dict[str, list[Board]] = {
    "greenhouse": [
        Board(ats="greenhouse", slug="stripe", company_name="Stripe"),
        Board(ats="greenhouse", slug="gitlab", company_name="GitLab"),
        Board(ats="greenhouse", slug="airbnb", company_name="Airbnb"),
    ],
    "lever": [Board(ats="lever", slug="palantir", company_name="Palantir")],
    "ashby": [
        Board(ats="ashby", slug="linear", company_name="Linear"),
        Board(ats="ashby", slug="supabase", company_name="Supabase"),
    ],
}

__all__ = ["ATS_SOURCES", "DEFAULT_BOARDS", "SOURCES", "SkipSource"]
