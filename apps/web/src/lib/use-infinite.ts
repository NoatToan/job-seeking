"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readViewCache, writeViewCache } from "./view-cache";

export interface InfinitePage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UseInfiniteListResult<T> {
  items: T[];
  nextCursor: string | null;
  loading: boolean;
  error: Error | null;
  /** `false` until the first page has resolved (success or failure) — guards empty-state flicker. */
  initialized: boolean;
  /** Fetches the next page, if any. No-op while a request is already in flight. */
  loadMore: () => void;
  /** Re-fetches the page that just failed (first page if the list is still empty). */
  retry: () => void;
  /** `true` when this mount started from the view cache (Back navigation) instead of fetching. */
  restored: boolean;
}

interface CachedList<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UseInfiniteListOptions<P> {
  onPage?: (page: P) => void;
  /** Keeps the loaded pages in the view cache (`lib/view-cache.ts`) under this key, so coming
   * back to the screen restores them instead of refetching page 1. Must change with `deps`. */
  cacheKey?: string;
}

/**
 * Cursor-based infinite list shared by the feed and live search (`docs/product/FLOW_V2.md` §3,
 * "Cursor pagination"). Fetches page 1 whenever `deps` changes, then lets the caller request
 * further pages (typically from an `IntersectionObserver` sentinel) via `loadMore`.
 *
 * A `fetchingRef` guard — not just the `loading` state — makes sure a rapidly-firing observer
 * (or a double-click on retry) only ever has one request in flight: state updates are async, so
 * checking `loading` alone can race.
 */
export function useInfiniteList<T, P extends InfinitePage<T>>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
  deps: readonly unknown[],
  options: UseInfiniteListOptions<P> | ((page: P) => void) = {},
): UseInfiniteListResult<T> {
  const { onPage, cacheKey } = typeof options === "function" ? { onPage: options, cacheKey: undefined } : options;
  const cacheId = cacheKey ? `list:${cacheKey}` : undefined;
  // Read once on mount: a cache hit renders the previous pages on the very first paint.
  const [initialCache] = useState(() => (cacheId ? readViewCache<CachedList<T>>(cacheId) : undefined));
  const [items, setItems] = useState<T[]>(initialCache?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialCache?.nextCursor ?? null);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState<Error | null>(null);
  const [initialized, setInitialized] = useState(Boolean(initialCache));
  const fetchingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(initialCache?.nextCursor ?? undefined);
  const fetchPageRef = useRef(fetchPage);
  const onPageRef = useRef(onPage);
  const cacheIdRef = useRef(cacheId);
  // The deps key whose pages are already on screen from the cache (survives StrictMode's double
  // effect run, unlike a "skip once" flag).
  const restoredKeyRef = useRef(initialCache ? cacheId : undefined);

  useEffect(() => {
    fetchPageRef.current = fetchPage;
    onPageRef.current = onPage;
    cacheIdRef.current = cacheId;
  });

  const run = useCallback((cursor: string | undefined, reset: boolean) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    fetchPageRef
      .current(cursor)
      .then((page) => {
        setItems((prev) => {
          const next = reset ? page.items : [...prev, ...page.items];
          const id = cacheIdRef.current;
          if (id) writeViewCache<CachedList<T>>(id, { items: next, nextCursor: page.nextCursor });
          return next;
        });
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor ?? undefined;
        setInitialized(true);
        onPageRef.current?.(page);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setLoading(false);
        fetchingRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (cacheId && restoredKeyRef.current === cacheId) return;
    restoredKeyRef.current = undefined;
    cursorRef.current = undefined;
    // Resetting state here (rather than deriving it) is what lets a filter change synchronously
    // clear the stale previous page before the new page's request resolves.
    setItems([]);
    setNextCursor(null);
    setInitialized(false);
    run(undefined, true);
    // `deps` is caller-controlled, intentionally not `run` (stable identity already).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(() => {
    if (cursorRef.current) run(cursorRef.current, false);
  }, [run]);

  const retry = useCallback(() => {
    run(items.length ? cursorRef.current : undefined, items.length === 0);
  }, [run, items.length]);

  return { items, nextCursor, loading, error, initialized, loadMore, retry, restored: Boolean(initialCache) };
}
