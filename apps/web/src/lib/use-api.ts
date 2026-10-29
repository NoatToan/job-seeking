"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/**
 * Minimal client-side data-fetching hook: loading/error/data/reload.
 *
 * Decided here over TanStack Query (see docs/product/ARCHITECTURE.md §3): the SPA only needs
 * one-shot GET requests on a handful of pages, so a small hook avoids an extra dependency.
 * Re-runs `fn` whenever an entry in `deps` changes, and ignores results from a stale run.
 */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[]): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  // Always call the latest closure without re-running the effect just because `fn`'s identity
  // changed; the effect re-runs only when `deps` (or `reload`) change. Refs must only be written
  // outside of render, so this runs in its own effect (every render; the write itself is cheap).
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    // One-shot fetch: loading/error must reset synchronously when `deps` change, before the
    // async call below resolves, so the stale previous result isn't shown as current.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
