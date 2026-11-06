"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { Button, EmptyState, JobListItem } from "@ujc/ui";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { readViewCache, useViewState, writeViewCache } from "@/lib/view-cache";
import { JobDetail } from "@/app/jobs/job-detail";
import { WorkHoursBadge } from "@/app/work-hours";
import { useMarkViewedAfterDwell, useViewedJobs } from "@/lib/viewed";

/** Matches Tailwind's `lg` breakpoint (64rem): the width where the detail panel is shown. */
const WIDE_QUERY = "(min-width: 64rem)";
/** Below this, the browser stops shrinking to fit and the page scrolls a little instead. */
const MIN_BROWSER_HEIGHT_PX = 420;
/** Air under the two columns, matching the page's bottom padding. */
const BOTTOM_GAP_PX = 16;
/** Wait for the scroll to settle before fetching a description, so flicking past 30 rows
 * doesn't fire 30 requests (the header still updates instantly from the list row). */
const DETAIL_FETCH_DELAY_MS = 150;

const NO_TERMS: readonly string[] = [];

export function jobHref(id: string): string {
  return `/jobs/view?id=${encodeURIComponent(id)}`;
}

function isWide(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(WIDE_QUERY).matches === true;
}

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** `true` on wide screens. `false` on the server (static prerender) and on phones, where the
 * panel isn't shown — so phones never fetch job details just for scrolling. */
function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide, () => false);
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function DetailPanel({
  job,
  signedIn,
  highlight,
}: {
  job: Job;
  signedIn: boolean;
  highlight: readonly string[];
}) {
  const fetchId = useDebounced(job.id, DETAIL_FETCH_DELAY_MS);
  // Read once it has stayed in the panel a moment (scroll-spy flicks past many rows).
  useMarkViewedAfterDwell(job.id);
  const { data, error, reload } = useApi(() => getJob(fetchId), [fetchId], { cacheKey: `job:${fetchId}` });
  // A job opened before is already in the view cache: show it without waiting for the debounce.
  const full = data && data.id === job.id ? data : (readViewCache<JobDetailType>(`api:job:${job.id}`) ?? null);
  return (
    // `key` re-mounts the content per job, replaying the slide-in animation.
    <div key={job.id} className="animate-detail-in">
      <JobDetail
        job={full ?? job}
        loadingDescription={!full && !error}
        signedIn={signedIn}
        highlight={highlight}
        variant="panel"
      />
      {error && fetchId === job.id ? (
        <div className="mt-4">
          <EmptyState
            tone="error"
            illustration="error"
            title="We couldn't load the full description"
            message={error.message}
            action={
              <Button variant="gray" onClick={reload}>
                Try again
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export interface JobBrowserProps {
  jobs: Job[];
  /** View-cache key for the selected job (e.g. "public" / "feed"), so Back keeps the selection. */
  stateKey: string;
  signedIn: boolean;
  /** Row actions (Save), rendered small on the right of each row. */
  renderActions?: (job: Job) => ReactNode;
  /** Rendered under the list (load-more sentinel, "Loading more…", end of list). */
  footer?: ReactNode;
  /** Words to highlight in the detail panel (lib/highlight `highlightTerms`). */
  highlight?: readonly string[];
}

/**
 * Home page list + detail (Slack requests: "small job list on the left, detail on the right; while
 * scrolling, the job at the top loads its detail", then "the job list must be its own scrolling
 * list, not the window"). On wide screens (`lg`) both columns fill the viewport under the sticky
 * nav bar and scroll independently: the list scrolls in its own container, the row at the top of
 * that container is the selected job, and clicking a row selects it. On narrower screens the
 * panel is hidden, the page scrolls normally and each row is a plain link to `/jobs/view`.
 */
export function JobBrowser({
  jobs,
  stateKey,
  signedIn,
  renderActions,
  footer,
  highlight = NO_TERMS,
}: JobBrowserProps) {
  const [selectedId, setSelectedId] = useViewState<string | null>(`selected:${stateKey}`, null);
  const wide = useIsWide();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;
  const viewed = useViewedJobs();
  const scrollKey = `list-scroll:${stateKey}`;

  // Back navigation: put the list's own scroll position back (the window's is restored by the
  // page, see useScrollRestoration).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const top = readViewCache<number>(scrollKey);
    if (el && top) el.scrollTop = top;
    // Once per mount: later renders (load more) must not jump the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lg: the two columns take exactly the room left under the filters, so the list (not the
  // window) scrolls and its last row is never below the fold. Re-measured whenever the page
  // above changes height (filters wrap, the source strip loads) or the window resizes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fit = () => {
      if (!isWide()) {
        root.style.height = "";
        return;
      }
      const top = root.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(MIN_BROWSER_HEIGHT_PX, window.innerHeight - top - BOTTOM_GAP_PX);
      root.style.height = `${Math.round(height)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", fit);
      observer?.disconnect();
    };
  }, []);

  // Scroll-spy: the first row that is at least half visible below the list's top edge is the
  // one "on top" (rows also snap to that edge, so it normally sits fully in view).
  const pickTopRow = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !isWide()) return;
    const line = el.getBoundingClientRect().top;
    for (const row of el.querySelectorAll<HTMLElement>("[data-job-id]")) {
      const rect = row.getBoundingClientRect();
      if (rect.top + rect.height / 2 > line) {
        const id = row.dataset.jobId ?? null;
        if (id && id !== selectedRef.current) setSelectedId(id);
        return;
      }
    }
  }, [setSelectedId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        writeViewCache(scrollKey, el.scrollTop);
        pickTopRow();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, [pickTopRow, scrollKey]);

  const onSelect = useCallback(
    (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      // Wide screens: show it in the panel. Phones, or ⌘/ctrl-click: follow the link.
      if (!isWide() || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      setSelectedId(id);
      event.currentTarget.closest("[data-job-id]")?.scrollIntoView?.({ block: "nearest" });
    },
    [setSelectedId],
  );

  return (
    <div
      ref={rootRef}
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]"
    >
      <div
        ref={scrollRef}
        data-testid="job-list-scroll"
        className="lg:-mx-1 lg:min-h-0 lg:snap-y lg:snap-proximity lg:overflow-y-auto lg:overscroll-y-contain lg:px-1 lg:py-1"
      >
        <div role="list" aria-label="Jobs" className="flex flex-col gap-2">
          {jobs.map((job) => (
            <div role="listitem" key={job.id} className="snap-start scroll-mt-1">
              <JobListItem
                job={job}
                href={jobHref(job.id)}
                linkAs={Link}
                selected={selected?.id === job.id}
                onSelect={onSelect(job.id)}
                actions={renderActions?.(job)}
                meta={<WorkHoursBadge job={job} />}
                viewed={viewed.has(job.id)}
              />
            </div>
          ))}
        </div>
        {footer}
      </div>
      <aside
        aria-label="Job details"
        aria-live="polite"
        className="hidden min-h-0 overflow-y-auto overscroll-contain rounded-card bg-grouped-secondary p-6 shadow-card lg:block"
      >
        {wide && selected ? <DetailPanel job={selected} signedIn={signedIn} highlight={highlight} /> : null}
      </aside>
    </div>
  );
}
