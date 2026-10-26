import logging
from collections.abc import Callable

from job_crawler.http import HttpClient
from job_crawler.models import Board, JobRecord, SourceResult

log = logging.getLogger(__name__)


def fetch_boards(
    http: HttpClient,
    boards: list[Board],
    fetch_board: Callable[[HttpClient, Board], list[JobRecord]],
) -> SourceResult:
    """Fetch every board; a failing board is logged and recorded but does not stop the others."""
    result = SourceResult()
    for i, board in enumerate(boards):
        if i:
            http.pause()
        try:
            jobs = fetch_board(http, board)
        except Exception as exc:  # noqa: BLE001 - keep going with the other boards
            message = f"{board.ats}/{board.slug}: {type(exc).__name__}: {exc}"
            log.warning("board failed: %s", message)
            result.errors.append(message)
            continue
        log.info("%s/%s: %d jobs", board.ats, board.slug, len(jobs))
        result.jobs.extend(jobs)
    if boards and len(result.errors) == len(boards):
        raise RuntimeError("all boards failed: " + "; ".join(result.errors))
    return result
