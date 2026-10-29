"""A small in-process sliding-window limiter for the per-IP OTP-send limit.

`email_otps` has no IP column (migration 007 is fixed by the FLOW_V2 spec), so the per-email
limits are counted in the database (see `otp.check_email_rate_limit`) while this one is kept
in memory, per process. On a single long-running host worker/server that's exact; on a
multi-instance or cold-starting serverless deployment it under-counts across instances/restarts,
trading perfect enforcement for not needing a schema change — the per-email DB-backed limits are
the hard backstop.
"""

import time
from collections import defaultdict
from collections.abc import Callable

Clock = Callable[[], float]


class SlidingWindowRateLimiter:
    def __init__(self, *, max_count: int, window_seconds: float, clock: Clock = time.time) -> None:
        self.max_count = max_count
        self.window_seconds = window_seconds
        self._clock = clock
        self._hits: dict[str, list[float]] = defaultdict(list)

    def allow(self, key: str) -> bool:
        """Records one hit for `key` and returns whether it was within the limit."""
        now = self._clock()
        cutoff = now - self.window_seconds
        hits = [t for t in self._hits[key] if t > cutoff]
        allowed = len(hits) < self.max_count
        hits.append(now)
        self._hits[key] = hits
        return allowed

    def reset(self) -> None:
        self._hits.clear()
