"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readViewCache, writeViewCache } from "./view-cache";

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
 *
 * With `cacheKey` it is stale-while-revalidate: the last result for that key (view cache, see
 * `lib/view-cache.ts`) renders immediately — no spinner when navigating Back — while a fresh
 * request runs in the background. The key must change whenever `deps` do.
 */
export function useApi<T>(
  fn: () => Promise<T>,
  deps: readonly unknown[],
  options: { cacheKey?: string } = {},
): UseApiState<T> {
  const cacheId = options.cacheKey ? `api:${options.cacheKey}` : undefined;
  const [data, setData] = useState<T | null>(() => (cacheId ? (readViewCache<T>(cacheId) ?? null) : null));
  const [loading, setLoading] = useState(data === null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  // Always call the latest closure without re-running the effect just because `fn`'s identity
  // changed; the effect re-runs only when `deps` (or `reload`) change. Refs must only be written
  // outside of render, so this runs in its own effect (every render; the write itself is cheap).
  const fnRef = useRef(fn);
  const cacheIdRef = useRef(cacheId);
  useEffect(() => {
    fnRef.current = fn;
    cacheIdRef.current = cacheId;
  });

  useEffect(() => {
    let cancelled = false;
    // One-shot fetch: loading/error must reset synchronously when `deps` change, before the
    // async call below resolves, so the stale previous result isn't shown as current.
    const id = cacheIdRef.current;
    const cached = id ? readViewCache<T>(id) : undefined;
    setLoading(cached === undefined);
    setError(null);
    if (cached !== undefined) setData(cached);
    fnRef
      .current()
      .then((result) => {
        if (id) writeViewCache(id, result);
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
