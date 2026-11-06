"use client";

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { sourceMeta, techInfo } from "@ujc/core";
import { Chip, cx, GlobeIcon, SearchField, SlidersIcon, TechIcon } from "@ujc/ui";
import { useViewState } from "@/lib/view-cache";
import { CountryFilter } from "@/app/country-filter";
import { pillClasses, PillSelect, PillToggle } from "@/app/pill-controls";
import { TechFilter } from "@/app/tech-filter";
import { TimezonePicker } from "@/app/work-hours";
import { clearViewed, useViewedJobs } from "@/lib/viewed";

/** "Posted within" options (Slack request: 3 days, 7 days, 1 month). Value = days, "" = any. */
export const POSTED_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "3", label: "Past 3 days" },
  { value: "7", label: "Past 7 days" },
  { value: "30", label: "Past month" },
] as const;

export interface JobFilterState {
  draftQ: string;
  setDraftQ: (v: string) => void;
  /** Debounced `draftQ` — what is actually sent. */
  q: string;
  source: string;
  setSource: (v: string) => void;
  remoteOnly: boolean;
  setRemoteOnly: (v: boolean) => void;
  country: string;
  setCountry: (v: string) => void;
  tech: string[];
  setTech: (v: string[]) => void;
  posted: string;
  setPosted: (v: string) => void;
  /** Stable key of every applied filter (list cache key / effect deps). */
  key: string;
  /** Query params for `GET /api/jobs` / `GET /api/feed`. */
  params: { q?: string; source?: string; remote?: boolean; country?: string; tech?: string; days?: number };
  activeCount: number;
  clear: () => void;
  /** "Unread only": the ids read when it was switched on (a snapshot, so the job you are reading
   * now doesn't vanish from the list under you). `null` = show everything. */
  hiddenIds: ReadonlySet<string> | null;
  setUnreadOnly: (on: boolean) => void;
}

/**
 * Every home-page filter in one place, kept in the view cache under `prefix` so Back from a job
 * restores them. Shared by the public catalogue and the signed-in feed.
 */
export function useJobFilters(prefix: string): JobFilterState {
  const [draftQ, setDraftQ] = useViewState(`${prefix}:draftQ`, "");
  const [q, setQ] = useViewState(`${prefix}:q`, "");
  const [source, setSource] = useViewState(`${prefix}:source`, "");
  const [remoteOnly, setRemoteOnly] = useViewState(`${prefix}:remote`, false);
  const [country, setCountry] = useViewState(`${prefix}:country`, "");
  const [tech, setTech] = useViewState<string[]>(`${prefix}:tech`, []);
  const [posted, setPosted] = useViewState(`${prefix}:posted`, "");
  const [hidden, setHidden] = useViewState<string[] | null>(`${prefix}:hidden`, null);
  const viewed = useViewedJobs();

  // Debounced search, 300 ms (SCREENS.md §4).
  useEffect(() => {
    const timer = setTimeout(() => setQ(draftQ), 300);
    return () => clearTimeout(timer);
  }, [draftQ, setQ]);

  const techKey = tech.join(",");
  return {
    draftQ,
    setDraftQ,
    q,
    source,
    setSource,
    remoteOnly,
    setRemoteOnly,
    country,
    setCountry,
    tech,
    setTech,
    posted,
    setPosted,
    key: JSON.stringify([q, source, remoteOnly, country, techKey, posted]),
    params: {
      q: q || undefined,
      source: source || undefined,
      remote: remoteOnly || undefined,
      country: country || undefined,
      tech: techKey || undefined,
      days: posted ? Number(posted) : undefined,
    },
    activeCount: [q, source, remoteOnly, country, posted].filter(Boolean).length + tech.length,
    hiddenIds: hidden ? new Set(hidden) : null,
    setUnreadOnly: (on: boolean) => setHidden(on ? [...viewed] : null),
    clear: () => {
      setDraftQ("");
      setQ("");
      setSource("");
      setRemoteOnly(false);
      setCountry("");
      setTech([]);
      setPosted("");
      setHidden(null);
    },
  };
}

/** "Read 42 jobs · Clear" — the read history kept in this browser (and the account). */
function ReadHistory() {
  const viewed = useViewedJobs();
  const [clearing, setClearing] = useState(false);
  return (
    <p className="flex items-center gap-2 text-subheadline text-label-secondary">
      Read {viewed.size} {viewed.size === 1 ? "job" : "jobs"}
      {viewed.size ? (
        <button
          type="button"
          disabled={clearing}
          onClick={() => {
            setClearing(true);
            void clearViewed()
              .catch(() => {})
              .finally(() => setClearing(false));
          }}
          className="rounded-control-sm font-medium text-tint hover:underline focus-ring disabled:opacity-50"
        >
          Clear read history
        </button>
      ) : null}
    </p>
  );
}

export interface JobFilterBarProps {
  filters: JobFilterState;
  /** Source ids to offer in the Source select. */
  sources: readonly string[];
  /** Extra controls at the end of the bar (feed: Best matches, Refresh scores). */
  extra?: ReactNode;
}

/**
 * Home filter bar (Slack requests: "the filter area takes too much room", then "looks like an admin
 * tool"): one big search pill like a job site, and a single row of filter pills under it — source,
 * country, posted-within, remote, unread and "More filters". Tech chips and the time-zone picker
 * open in a panel underneath only when asked for. Selected techs stay visible as small chips.
 */
export function JobFilterBar({ filters: f, sources, extra }: JobFilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-3">
      {/* Phones: search, then one sideways-scrolling row of pills. Wide: all on one line. */}
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center">
        <SearchField
          variant="hero"
          value={f.draftQ}
          onChange={f.setDraftQ}
          label="Search jobs"
          placeholder="Job title, company or skill — e.g. Next.js, Python"
          className="w-full xl:max-w-xl xl:min-w-[22rem] xl:flex-1"
        />
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <PillSelect label="Source" value={f.source} onChange={f.setSource}>
          <option value="">All sources</option>
          {sources.map((id) => (
            <option key={id} value={id}>
              {sourceMeta(id).label}
            </option>
          ))}
        </PillSelect>
        <CountryFilter value={f.country} onChange={f.setCountry} compact />
        <PillSelect label="Posted" value={f.posted} onChange={f.setPosted}>
          {POSTED_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </PillSelect>
        <PillToggle
          label="Remote"
          checked={f.remoteOnly}
          onChange={f.setRemoteOnly}
          icon={<GlobeIcon size={15} strokeWidth={2} aria-hidden />}
        />
        <PillToggle label="Unread" checked={f.hiddenIds !== null} onChange={f.setUnreadOnly} />
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((o) => !o)}
          className={cx(pillClasses(moreOpen || f.tech.length > 0), "px-3.5")}
        >
          <SlidersIcon size={15} strokeWidth={2} aria-hidden />
          More filters{f.tech.length ? ` (${f.tech.length})` : ""}
        </button>
        {!moreOpen
          ? f.tech.map((id) => (
              <Chip
                key={id}
                onRemove={() => f.setTech(f.tech.filter((t) => t !== id))}
                removeLabel="Remove"
                icon={<TechIcon id={id} size={14} />}
                className="h-9 border border-separator bg-background"
              >
                {techInfo(id).label}
              </Chip>
            ))
          : null}
        {f.activeCount ? (
          <button
            type="button"
            onClick={f.clear}
            className="h-9 rounded-full px-2 text-subheadline font-medium text-tint hover:underline focus-ring"
          >
            Clear all
          </button>
        ) : null}
        {extra}
        </div>
      </div>
      {moreOpen ? (
        <div
          id={panelId}
          className="flex flex-col gap-3 rounded-[18px] border border-separator bg-background p-4 shadow-raised animate-fade-in"
        >
          <TechFilter value={f.tech} onChange={f.setTech} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 hairline-t pt-3">
            <TimezonePicker />
            <ReadHistory />
          </div>
        </div>
      ) : null}
    </div>
  );
}
