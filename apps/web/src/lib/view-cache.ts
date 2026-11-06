"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * In-memory view cache for client-side navigation (Slack request — "going into a page and back
 * reloads everything"). The SPA is a static export, so there is no server render to lean on; the
 * client equivalent of the App Router's router cache is to keep what a screen already fetched
 * (list pages, filters, scroll position, job details) for the life of the tab, so pressing Back
 * restores the previous screen instantly instead of refetching and jumping to the top.
 *
 * Module-level on purpose: it survives unmounts but not a full page reload, and never persists
 * personal data to storage. `clearViewCache()` runs on sign-out.
 */
const store = new Map<string, { value: unknown; at: number }>();

/** Entries older than this are treated as missing (lists get refetched from page 1). */
export const VIEW_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

export function readViewCache<T>(key: string, maxAgeMs: number = VIEW_CACHE_MAX_AGE_MS): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > maxAgeMs) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function writeViewCache<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
}

export function clearViewCache(): void {
  store.clear();
}

/**
 * `useState` whose value outlives the component: re-mounting with the same `key` (e.g. coming
 * back to `/`) starts from the last value instead of `initial`. Used for filters and selection.
 */
export function useViewState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readViewCache<T>(key, Infinity) ?? initial);
  const set = useCallback(
    (next: T) => {
      writeViewCache(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

// `useLayoutEffect` warns during the static-export prerender; it only matters in the browser.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Saves `window.scrollY` under `key` while the screen is mounted and restores it once `ready`
 * (i.e. the cached content is on screen), so Back lands where the user left off.
 */
export function useScrollRestoration(key: string, ready: boolean): void {
  const storeKey = `scroll:${key}`;
  const restoredRef = useRef(false);

  useIsoLayoutEffect(() => {
    // Restore once, on the mount that came back to cached content; a later filter change
    // (new key) or load-more must never jump the page.
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    const y = readViewCache<number>(storeKey);
    if (y) window.scrollTo({ top: y, behavior: "instant" });
  }, [storeKey, ready]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writeViewCache(storeKey, window.scrollY));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [storeKey]);
}
