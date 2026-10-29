"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  onPage?: (page: P) => void,
): UseInfiniteListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [initialized, setInitialized] = useState(false);
  const fetchingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const fetchPageRef = useRef(fetchPage);
  const onPageRef = useRef(onPage);

  useEffect(() => {
    fetchPageRef.current = fetchPage;
    onPageRef.current = onPage;
  });

  const run = useCallback((cursor: string | undefined, reset: boolean) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    fetchPageRef
      .current(cursor)
      .then((page) => {
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
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
    cursorRef.current = undefined;
    // Resetting state here (rather than deriving it) is what lets a filter change synchronously
    // clear the stale previous page before the new page's request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return { items, nextCursor, loading, error, initialized, loadMore, retry };
}
