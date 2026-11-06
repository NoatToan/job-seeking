"use client";

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { sourceMeta, techInfo } from "@ujc/core";
import { Chip, ChevronRightIcon, cx, SearchField, TechIcon, Toggle } from "@ujc/ui";
import { useViewState } from "@/lib/view-cache";
import { CountryFilter } from "@/app/country-filter";
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

const SELECT =
  "max-w-[13rem] truncate rounded-control-sm bg-fill-tertiary px-2 py-1.5 text-subheadline text-label focus-ring";

function LabeledSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        {children}
      </select>
    </>
  );
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
 * Compact filter bar (Slack request: "the filter area takes too much room"): one row with search,
 * source, country, posted-within, remote and a Tech toggle; tech chips and the time-zone picker
 * open in a panel underneath only when asked for. Selected techs stay visible as small chips.
 */
export function JobFilterBar({ filters: f, sources, extra }: JobFilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1">
          <SearchField value={f.draftQ} onChange={f.setDraftQ} label="Search jobs" placeholder="Job title, company or skill" />
        </div>
        <LabeledSelect label="Source" value={f.source} onChange={f.setSource}>
          <option value="">All sources</option>
          {sources.map((id) => (
            <option key={id} value={id}>
              {sourceMeta(id).label}
            </option>
          ))}
        </LabeledSelect>
        <CountryFilter value={f.country} onChange={f.setCountry} compact />
        <LabeledSelect label="Posted" value={f.posted} onChange={f.setPosted}>
          {POSTED_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </LabeledSelect>
        <label className="flex items-center gap-1.5 text-subheadline text-label-secondary">
          <Toggle label="Remote only" checked={f.remoteOnly} onChange={f.setRemoteOnly} />
          Remote
        </label>
        <label className="flex items-center gap-1.5 text-subheadline text-label-secondary">
          <Toggle label="Unread only" checked={f.hiddenIds !== null} onChange={f.setUnreadOnly} />
          Unread
        </label>
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((o) => !o)}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-fill-tertiary px-3 text-subheadline font-medium text-label hover:bg-fill-secondary focus-ring"
        >
          More filters{f.tech.length ? ` (${f.tech.length})` : ""}
          <ChevronRightIcon size={14} strokeWidth={2.25} aria-hidden className={cx("transition-transform duration-200", moreOpen && "rotate-90")} />
        </button>
        {!moreOpen
          ? f.tech.map((id) => (
              <Chip
                key={id}
                onRemove={() => f.setTech(f.tech.filter((t) => t !== id))}
                removeLabel="Remove"
                icon={<TechIcon id={id} size={14} />}
              >
                {techInfo(id).label}
              </Chip>
            ))
          : null}
        {f.activeCount ? (
          <button type="button" onClick={f.clear} className="text-subheadline font-medium text-tint hover:underline focus-ring rounded-control-sm">
            Clear
          </button>
        ) : null}
        {extra}
      </div>
      {moreOpen ? (
        <div id={panelId} className="flex flex-col gap-2 rounded-card bg-grouped-secondary p-3 shadow-card animate-fade-in">
          <TechFilter value={f.tech} onChange={f.setTech} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <TimezonePicker />
            <ReadHistory />
          </div>
        </div>
      ) : null}
    </div>
  );
}
