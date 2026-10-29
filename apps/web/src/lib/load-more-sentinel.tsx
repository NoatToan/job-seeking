"use client";

import { useEffect, useRef } from "react";

export interface LoadMoreSentinelProps {
  /** Whether the sentinel should currently be watched (e.g. `false` while a page is loading). */
  active: boolean;
  onVisible: () => void;
}

/**
 * An invisible marker rendered after the last item of an infinite-scrolling list. Fires
 * `onVisible` whenever it scrolls into view, via `IntersectionObserver` — the standard
 * "infinite scroll" trigger, decoupled from any specific list's fetching logic.
 */
export function LoadMoreSentinel({ active, onVisible }: LoadMoreSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, onVisible]);

  return <div ref={ref} aria-hidden="true" className="h-px w-full" />;
}
