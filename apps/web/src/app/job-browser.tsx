"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { Button, EmptyState, JobListItem } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { readViewCache, useViewState, writeViewCache } from "@/lib/view-cache";
import { JobDetail } from "@/app/jobs/job-detail";
import { WorkHoursBadge } from "@/app/work-hours";
import { useBasedIn } from "@/lib/based-in";
import { markViewed, useMarkViewedAfterDwell, useViewedJobs } from "@/lib/viewed";
import { jobPagePath } from "@/lib/job-url";
import {
  OVERSCAN_ROWS,
  type RowWindow,
  layoutRows,
  nextSelection,
  offsetToReveal,
  refreshWindow,
} from "@/lib/windowed-list";

/** Matches Tailwind's `lg` breakpoint (64rem): the width where the detail panel is shown. */
const WIDE_QUERY = "(min-width: 64rem)";
/** Below this, the browser stops shrinking to fit and the page scrolls a little instead. */
const MIN_BROWSER_HEIGHT_PX = 280;
/** Air under the two columns, matching the page's bottom padding. */
const BOTTOM_GAP_PX = 16;
/** Wait for the scroll to settle before fetching a description, so flicking past 30 rows
 * doesn't fire 30 requests (the header still updates instantly from the list row). */
const DETAIL_FETCH_DELAY_MS = 150;

const NO_TERMS: readonly string[] = [];
/** Load the next page once the user has scrolled through this share of the list (Slack: "load
 * more at 70%, don't wait until I hit the bottom"). */
const PRELOAD_AT = 0.7;
/** Space between rows: the list's `gap-2.5`. */
const ROW_GAP_PX = 10;

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
  const { t } = useTranslation("home");
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
        pageHref={jobPagePath(job)}
      />
      {error && fetchId === job.id ? (
        <div className="mt-4">
          <EmptyState
            tone="error"
            illustration="error"
            title={t("detailPanel.errorTitle")}
            message={error.message}
            action={
              <Button variant="gray" onClick={reload}>
                {t("common:tryAgain")}
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
  /** Called when the user has scrolled 70% of the way down (list on wide screens, window on
   * phones). Pass it only while there is a next page and none is loading. */
  onNearEnd?: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
}

/**
 * Home page list + detail (Slack requests: "small job list on the left, detail on the right; while
 * scrolling, the job at the top loads its detail", then "the job list must be its own scrolling
 * list, not the window"). On wide screens (`lg`) both columns fill the viewport under the sticky
 * nav bar and scroll independently: the list scrolls in its own container, clicking a row selects
 * it, and scrolling keeps the selection until it leaves the viewport (then the nearest visible row
 * takes over). Only ~50 rows around the viewport are mounted, so long lists stay fast. On narrower
 * screens the panel is hidden, the page scrolls normally and each row is a plain link to
 * `/jobs/view`.
 */
export function JobBrowser({
  jobs,
  stateKey,
  signedIn,
  renderActions,
  footer,
  highlight = NO_TERMS,
  onNearEnd,
}: JobBrowserProps) {
  const { t } = useTranslation("home");
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
  const { country: basedIn } = useBasedIn();
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

  // Windowing: only ~50 rows around the viewport are in the DOM (lib/windowed-list). Heights of
  // rows already rendered are remembered (also across Back) so the spacers stay accurate.
  const listRef = useRef<HTMLDivElement | null>(null);
  const heightsKey = `row-heights:${stateKey}`;
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(
    () => readViewCache<ReadonlyMap<string, number>>(heightsKey) ?? new Map(),
  );
  const layout = useMemo(() => layoutRows(jobs.map((j) => j.id), heights, ROW_GAP_PX), [jobs, heights]);
  const layoutRef = useRef(layout);
  const jobsRef = useRef(jobs);
  // Layout effect, so the window update below (also a layout effect) already sees the new rows.
  useLayoutEffect(() => {
    layoutRef.current = layout;
    jobsRef.current = jobs;
  }, [layout, jobs]);
  const [range, setRange] = useViewState<RowWindow>(`rows:${stateKey}`, {
    start: 0,
    end: 2 * OVERSCAN_ROWS,
  });
  const rangeRef = useRef(range);

  /** Where the viewport is, in px from the top of the list: the list's own scroll box on wide
   * screens, the window on phones. */
  const viewport = useCallback((): { offset: number; view: number } | null => {
    const list = listRef.current;
    if (!list) return null;
    const el = scrollRef.current;
    if (el && isWide()) {
      return {
        offset: el.scrollTop - (list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop),
        view: el.clientHeight,
      };
    }
    return { offset: -list.getBoundingClientRect().top, view: window.innerHeight };
  }, []);

  const updateWindow = useCallback(() => {
    const vp = viewport();
    if (!vp) return;
    const next = refreshWindow(rangeRef.current, layoutRef.current, vp.offset, vp.view);
    if (next !== rangeRef.current) {
      rangeRef.current = next;
      setRange(next);
    }
  }, [setRange, viewport]);

  // Measure the rows just rendered; remember heights that changed and re-layout once.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let next: Map<string, number> | null = null;
    for (const row of list.querySelectorAll<HTMLElement>("[data-row-id]")) {
      const h = row.offsetHeight;
      const id = row.dataset.rowId;
      if (!id || h <= 0) continue; // not laid out (tests, hidden)
      if (Math.abs((heights.get(id) ?? -1) - h) > 0.5) {
        next ??= new Map(heights);
        next.set(id, h);
      }
    }
    if (next) {
      writeViewCache(heightsKey, next);
      setHeights(next);
    }
  }, [jobs, range, heights, heightsKey]);

  // New rows (load more, filters) or new heights: make sure the window still covers the viewport.
  useLayoutEffect(() => {
    updateWindow();
  }, [layout, updateWindow]);

  // Scroll-spy: keep the selected job while at least half of it is still visible; once it
  // scrolls out, the nearest visible row on that side takes over (lib/windowed-list
  // `nextSelection`). No snapping and no scroll-to, so scrolling stays smooth.
  const spy = useCallback(() => {
    if (!isWide()) return;
    const vp = viewport();
    if (!vp) return;
    const list = jobsRef.current;
    const current = list.findIndex((j) => j.id === (selectedRef.current ?? list[0]?.id));
    const next = nextSelection(layoutRef.current, current, vp.offset, vp.view);
    if (next !== null && list[next]) setSelectedId(list[next].id);
  }, [setSelectedId, viewport]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        writeViewCache(scrollKey, el.scrollTop);
        updateWindow();
        spy();
      });
    };
    let windowFrame = 0;
    const onWindowScroll = () => {
      cancelAnimationFrame(windowFrame);
      windowFrame = requestAnimationFrame(updateWindow);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    window.addEventListener("resize", onWindowScroll);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(windowFrame);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("resize", onWindowScroll);
    };
  }, [spy, updateWindow, scrollKey]);

  // Preload the next page at 70%: the list's own scroll on wide screens, the window on phones.
  const nearEndRef = useRef(onNearEnd);
  useEffect(() => {
    nearEndRef.current = onNearEnd;
  }, [onNearEnd]);
  useEffect(() => {
    const el = scrollRef.current;
    const check = () => {
      const fire = nearEndRef.current;
      if (!fire) return;
      const [top, view, total] =
        el && isWide()
          ? [el.scrollTop, el.clientHeight, el.scrollHeight]
          : [window.scrollY, window.innerHeight, document.documentElement.scrollHeight];
      if (total > view && top + view >= total * PRELOAD_AT) fire();
    };
    el?.addEventListener("scroll", check, { passive: true });
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      el?.removeEventListener("scroll", check);
      window.removeEventListener("scroll", check);
    };
  }, []);

  // Keyboard (wide screens): ↓ or → = next job, ↑ or ← = previous. Ignored while typing in a
  // field or with modifier keys, so search, selects and browser shortcuts keep working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isWide() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!step || jobs.length === 0) return;
      // Leave arrows alone inside open popovers / dialogs (sliders, menus).
      if (e.target instanceof HTMLElement && e.target.closest("[role=dialog],[role=listbox],[role=radiogroup]")) return;
      e.preventDefault();
      const current = jobs.findIndex((j) => j.id === (selectedRef.current ?? jobs[0]?.id));
      const next = jobs[Math.max(0, Math.min(jobs.length - 1, current + step))];
      if (!next) return;
      setSelectedId(next.id);
      // Keep it on screen with the least movement, instantly (an animated scroll-to felt laggy).
      // It is then fully visible, so the scroll-spy leaves the selection alone.
      const vp = viewport();
      const el = scrollRef.current;
      const target = vp ? offsetToReveal(layoutRef.current, jobs.indexOf(next), vp.offset, vp.view) : null;
      if (el && vp && target !== null) el.scrollTop += target - vp.offset;
      // Stepping onto the last loaded rows counts as reaching the end of the list.
      if (jobs.indexOf(next) >= jobs.length * PRELOAD_AT) nearEndRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jobs, setSelectedId, viewport]);

  const onSelect = useCallback(
    (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
      // Wide screens: show it in the panel. Phones, or ⌘/ctrl-click: follow the link.
      if (!isWide() || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      setSelectedId(id);
      // A click is a deliberate open: mark it read now (local store first, API synced behind),
      // no dwell wait. Scroll-spy selections still need the dwell.
      markViewed(id);
    },
    [setSelectedId],
  );

  // Rows to render, clamped to the current list (it can shrink when filters change). The flex gap
  // already separates each spacer from its neighbour row, so the spacers leave one gap out.
  const n = jobs.length;
  const start = Math.min(range.start, Math.max(0, n - 1));
  const end = Math.min(n, Math.max(range.end, start + 1));
  const topSpacer = start > 0 ? layout.tops[start] - ROW_GAP_PX : 0;
  const lastShown = end - 1;
  const bottomSpacer =
    end < n && lastShown >= 0 ? layout.total - (layout.tops[lastShown] + layout.heights[lastShown]) - ROW_GAP_PX : 0;

  return (
    <div
      ref={rootRef}
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]"
    >
      <div
        ref={scrollRef}
        data-testid="job-list-scroll"
        className="lg:-mx-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:px-1 lg:py-1"
      >
        <div ref={listRef} role="list" aria-label={t("list.jobsAriaLabel")} className="flex flex-col gap-2.5">
          {topSpacer > 0 ? <div aria-hidden="true" style={{ height: topSpacer }} /> : null}
          {jobs.slice(start, end).map((job) => (
            <div role="listitem" key={job.id} data-row-id={job.id}>
              <JobListItem
                job={job}
                href={jobHref(job.id)}
                linkAs={Link}
                selected={selected?.id === job.id}
                onSelect={onSelect(job.id)}
                actions={renderActions?.(job)}
                meta={<WorkHoursBadge job={job} />}
                viewed={viewed.has(job.id)}
                basedIn={basedIn}
              />
            </div>
          ))}
          {bottomSpacer > 0 ? <div aria-hidden="true" style={{ height: bottomSpacer }} /> : null}
        </div>
        {footer}
      </div>
      <aside
        aria-label={t("list.jobDetailsAriaLabel")}
        aria-live="polite"
        className="hidden min-h-0 overflow-hidden rounded-[22px] border border-separator bg-background shadow-raised lg:flex lg:flex-col"
      >
        {/* The border + radius live on the <aside>, the scrolling on this inner box, so the scrollbar
            sits inside the rounded frame instead of painting over its border. */}
        <div className="scroll-inset min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          {wide && selected ? <DetailPanel job={selected} signedIn={signedIn} highlight={highlight} /> : null}
        </div>
      </aside>
    </div>
  );
}
