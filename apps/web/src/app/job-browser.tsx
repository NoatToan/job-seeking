"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { Button, EmptyState, JobListItem } from "@ujc/ui";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { readViewCache, useViewState } from "@/lib/view-cache";
import { JobDetail } from "@/app/jobs/job-detail";

/** Matches Tailwind's `lg` breakpoint (64rem): the width where the detail panel is shown. */
const WIDE_QUERY = "(min-width: 64rem)";
/** Sticky nav bar (44px) + a little air: the row crossing this line is "the job on top". */
const FOCUS_LINE_PX = 56;
/** Wait for the scroll to settle before fetching a description, so flicking past 30 rows
 * doesn't fire 30 requests (the header still updates instantly from the list row). */
const DETAIL_FETCH_DELAY_MS = 150;

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

function DetailPanel({ job, signedIn }: { job: Job; signedIn: boolean }) {
  const fetchId = useDebounced(job.id, DETAIL_FETCH_DELAY_MS);
  const { data, error, reload } = useApi(() => getJob(fetchId), [fetchId], { cacheKey: `job:${fetchId}` });
  // A job opened before is already in the view cache: show it without waiting for the debounce.
  const full = data && data.id === job.id ? data : (readViewCache<JobDetailType>(`api:job:${job.id}`) ?? null);
  return (
    // `key` re-mounts the content per job, replaying the slide-in animation.
    <div key={job.id} className="animate-detail-in">
      <JobDetail job={full ?? job} loadingDescription={!full && !error} signedIn={signedIn} variant="panel" />
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
}

/**
 * Home page list + detail (Slack request: "small job list on the left, detail on the right; while
 * scrolling, the job at the top of the screen loads its detail"). On wide screens (`lg`) the
 * left column is a compact list and the right column a sticky detail panel; the row crossing the
 * top of the viewport becomes the selected job as you scroll, and clicking a row selects it.
 * On narrower screens the panel is hidden and each row is a plain link to `/jobs/view`.
 */
export function JobBrowser({ jobs, stateKey, signedIn, renderActions, footer }: JobBrowserProps) {
  const [selectedId, setSelectedId] = useViewState<string | null>(`selected:${stateKey}`, null);
  const wide = useIsWide();
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null;

  // Scroll-spy: the first row whose bottom is below the focus line is the one "on top".
  const pickTopRow = useCallback(() => {
    const list = listRef.current;
    if (!list || !isWide()) return;
    const rows = list.querySelectorAll<HTMLElement>("[data-job-id]");
    for (const row of rows) {
      if (row.getBoundingClientRect().bottom > FOCUS_LINE_PX) {
        const id = row.dataset.jobId ?? null;
        if (id && id !== selectedRef.current) setSelectedId(id);
        return;
      }
    }
  }, [setSelectedId]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pickTopRow);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pickTopRow]);

  const onSelect = useCallback(
    (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      // Wide screens: show it in the panel. Phones, or ⌘/ctrl-click: follow the link.
      if (!isWide() || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      setSelectedId(id);
    },
    [setSelectedId],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] lg:items-start">
      <div>
        <div ref={listRef} role="list" aria-label="Jobs" className="flex flex-col gap-2">
          {jobs.map((job) => (
            <div role="listitem" key={job.id}>
              <JobListItem
                job={job}
                href={jobHref(job.id)}
                linkAs={Link}
                selected={selected?.id === job.id}
                onSelect={onSelect(job.id)}
                actions={renderActions?.(job)}
              />
            </div>
          ))}
        </div>
        {footer}
      </div>
      <aside
        aria-label="Job details"
        aria-live="polite"
        className="hidden overflow-y-auto overscroll-contain rounded-card bg-grouped-secondary p-6 shadow-card lg:sticky lg:top-14 lg:block lg:max-h-[calc(100dvh-4.5rem)]"
      >
        {wide && selected ? <DetailPanel job={selected} signedIn={signedIn} /> : null}
      </aside>
    </div>
  );
}
