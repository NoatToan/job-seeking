"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Job } from "@ujc/core";
import type { ReactNode } from "react";
import { sourceMeta, techInfo } from "@ujc/core";
import { Chip, ClockIcon, cx, GlobeIcon, RangeSlider, SearchField, SlidersIcon, TechIcon } from "@ujc/ui";
import { useQueryStates } from "nuqs";
import { useViewState } from "@/lib/view-cache";
import { jobFilterParsers, POSTED_DAYS } from "@/lib/url-state";
import { CountryFilter } from "@/app/country-filter";
import { pillClasses, PillSelect, PillToggle } from "@/app/pill-controls";
import { TechFilter } from "@/app/tech-filter";
import { TimezonePicker } from "@/app/work-hours";
import { clearViewed, useViewedJobs } from "@/lib/viewed";
import { useUserTimezone } from "@/lib/user-timezone";
import { jobFitsHours, shortZoneName } from "@/lib/work-hours";

type PostedDays = (typeof POSTED_DAYS)[number];

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
  /** "Hours I want to work", whole hours on the user's clock ([9, 17]); `null` = any. Applied in
   * the browser (it depends on the user's time zone), so it is not part of `key` / `params`. */
  hours: [number, number] | null;
  setHours: (v: [number, number] | null) => void;
}

/**
 * Every home-page filter in one place. The applied filters live in the URL (nuqs,
 * `jobFilterParsers`), so a filtered list can be shared or bookmarked and Back from a job restores
 * it. Only the "Unread" snapshot stays in the view cache under `prefix`: it is a list of job ids
 * read in this browser, not something to put in a link. Shared by the public catalogue and the
 * signed-in feed.
 */
export function useJobFilters(prefix: string): JobFilterState {
  const [url, setUrl] = useQueryStates(jobFilterParsers);
  const { q, source, remote: remoteOnly, country, tech, posted, hours } = url;
  // The search box shows keystrokes at once; the URL (and the request) follow 300 ms later
  // (SCREENS.md §4). An outside change of `q` (Clear, Back) resets the box.
  const [draftQ, setDraftQ] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setDraftQ(q);
  }
  const [hidden, setHidden] = useViewState<string[] | null>(`${prefix}:hidden`, null);
  const viewed = useViewedJobs();

  useEffect(() => {
    if (draftQ === q) return;
    const timer = setTimeout(() => {
      setSyncedQ(draftQ);
      void setUrl({ q: draftQ });
    }, 300);
    return () => clearTimeout(timer);
  }, [draftQ, q, setUrl]);

  const techKey = tech.join(",");
  const postedValue = posted ?? "";
  return {
    draftQ,
    setDraftQ,
    q,
    source,
    setSource: (v) => void setUrl({ source: v }),
    remoteOnly,
    setRemoteOnly: (v) => void setUrl({ remote: v }),
    country,
    setCountry: (v) => void setUrl({ country: v }),
    tech,
    setTech: (v) => void setUrl({ tech: v }),
    posted: postedValue,
    setPosted: (v) => void setUrl({ posted: (POSTED_DAYS as readonly string[]).includes(v) ? (v as PostedDays) : null }),
    key: JSON.stringify([q, source, remoteOnly, country, techKey, postedValue]),
    params: {
      q: q || undefined,
      source: source || undefined,
      remote: remoteOnly || undefined,
      country: country || undefined,
      tech: techKey || undefined,
      days: posted ? Number(posted) : undefined,
    },
    activeCount: [q, source, remoteOnly, country, posted, hours].filter(Boolean).length + tech.length,
    hours,
    setHours: (v) => void setUrl({ hours: v }),
    hiddenIds: hidden ? new Set(hidden) : null,
    setUnreadOnly: (on: boolean) => setHidden(on ? [...viewed] : null),
    clear: () => {
      setDraftQ("");
      setHidden(null);
      void setUrl(null);
    },
  };
}

/** The loaded jobs minus what the browser-side filters hide ("Unread", "Hours I want to work"). */
export function useVisibleJobs(f: JobFilterState, items: Job[]): Job[] {
  const { zone } = useUserTimezone();
  return useMemo(() => {
    let out = f.hiddenIds ? items.filter((j) => !f.hiddenIds?.has(j.id)) : items;
    if (f.hours) {
      const [from, to] = f.hours;
      out = out.filter((j) => jobFitsHours(j.timezones, zone, from * 60, to * 60));
    }
    return out;
  }, [items, f.hiddenIds, f.hours, zone]);
}

const HOUR_PRESETS: { label: string; value: [number, number] }[] = [
  { label: "Office 9–17", value: [9, 17] },
  { label: "Early 6–14", value: [6, 14] },
  { label: "Late 13–22", value: [13, 22] },
  { label: "Evening 18–24", value: [18, 24] },
];

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * "Hours" pill (Slack request: "a filter to drag my preferred hours"): a two-thumb slider on the
 * user's own clock. Keeps jobs whose 9–5 overlaps the chosen hours by at least 4h (or the whole
 * window when it is shorter); jobs with no stated time zone always stay.
 */
function HoursFilter({ value, onChange }: { value: [number, number] | null; onChange: (v: [number, number] | null) => void }) {
  const { zone } = useUserTimezone();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<[number, number]>(value ?? [9, 17]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const abbr = shortZoneName(zone);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Dragging applies live, so the list behind updates while the thumb moves.
  const apply = (v: [number, number]) => {
    setDraft(v);
    onChange(v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setDraft(value ?? [9, 17]);
          setOpen((o) => !o);
        }}
        className={cx(pillClasses(value !== null), "px-3.5")}
      >
        <ClockIcon size={15} strokeWidth={2} aria-hidden />
        {value ? `${hourLabel(value[0])}–${hourLabel(value[1])} ${abbr}` : "Hours"}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Hours I want to work"
          className="absolute left-0 z-50 mt-2 w-80 rounded-[18px] border border-separator bg-background p-4 shadow-overlay animate-pop-in"
        >
          <p className="text-headline text-label">Hours I want to work</p>
          <p className="mt-0.5 text-footnote text-label-secondary">
            On your clock ({abbr}). Shows jobs whose 9–5 overlaps these hours by 4h or more.
          </p>
          <p className="mt-3 text-title3 font-semibold text-label tabular-nums">
            {hourLabel(draft[0])} – {hourLabel(draft[1])}
          </p>
          <RangeSlider
            className="mt-2"
            labels={["Start of your day", "End of your day"]}
            min={0}
            max={24}
            value={draft}
            onChange={apply}
            format={hourLabel}
          />
          <div aria-hidden className="mt-1 flex justify-between text-caption text-label-tertiary tabular-nums">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {HOUR_PRESETS.map((p) => (
              <Chip
                key={p.label}
                selected={draft[0] === p.value[0] && draft[1] === p.value[1]}
                onClick={() => apply(p.value)}
                className="h-7 text-footnote"
              >
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="mt-3 flex justify-between hairline-t pt-3">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded-control-sm text-subheadline font-medium text-tint hover:underline focus-ring"
            >
              Any hours
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-label px-4 py-1.5 text-subheadline font-semibold text-background focus-ring"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
        <HoursFilter value={f.hours} onChange={f.setHours} />
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
