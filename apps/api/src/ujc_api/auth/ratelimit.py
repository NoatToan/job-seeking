"""A small in-process sliding-window limiter for the per-IP OTP-send limit.

`email_otps` has no IP column (migration 007 is fixed by the FLOW_V2 spec), so the per-email
limits are counted in the database (see `otp.check_email_rate_limit`) while this one is kept
in memory, per process. On a single long-running host worker/server that's exact; on a
multi-instance or cold-starting serverless deployment it under-counts across instances/restarts,
trading perfect enforcement for not needing a schema change — the per-email DB-backed limits are
the hard backstop.
"""

import time
from collections import OrderedDict
from collections.abc import Callable

Clock = Callable[[], float]

# Hard cap on distinct keys (IPs / user ids) held at once. Keys whose hits have all left the
# window are dropped as they age out (see `allow`), so in practice the map only holds keys seen
# in the last window; the cap stops a flood of distinct keys (e.g. many source IPs) from growing
# the process without bound. Evicting the least recently seen key only forgets *its* hits.
DEFAULT_MAX_KEYS = 10_000


class SlidingWindowRateLimiter:
    def __init__(
        self,
        *,
        max_count: int,
        window_seconds: float,
        clock: Clock = time.time,
        max_keys: int = DEFAULT_MAX_KEYS,
    ) -> None:
        self.max_count = max_count
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        # Ordered by most recent hit (oldest first), so expired keys are always at the front.
        self._hits: OrderedDict[str, list[float]] = OrderedDict()

    def allow(self, key: str) -> bool:
        """Records one hit for `key` and returns whether it was within the limit."""
        now = self._clock()
        cutoff = now - self.window_seconds
        hits = [t for t in self._hits.pop(key, ()) if t > cutoff]
        allowed = len(hits) < self.max_count
        hits.append(now)
        self._hits[key] = hits
        self._evict(cutoff)
        return allowed

    def _evict(self, cutoff: float) -> None:
        """Drops keys whose newest hit is outside the window, then the least recently seen keys
        beyond `max_keys`. Amortised O(1): only ever pops from the front."""
        while self._hits:
            oldest_key, oldest_hits = next(iter(self._hits.items()))
            if oldest_hits[-1] > cutoff and len(self._hits) <= self.max_keys:
                break
            del self._hits[oldest_key]

    def __len__(self) -> int:
        return len(self._hits)

    def reset(self) -> None:
        self._hits.clear()
