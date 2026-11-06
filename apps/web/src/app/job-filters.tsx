"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Job } from "@ujc/core";
import type { ReactNode } from "react";
import { sourceMeta, techInfo } from "@ujc/core";
import {
  Chip,
  ClockIcon,
  countryName,
  cx,
  flagEmoji,
  FloatingPanel,
  GlobeIcon,
  RangeSlider,
  SearchField,
  SearchIcon,
  SlidersIcon,
  TechIcon,
  useUiStrings,
} from "@ujc/ui";
import { useQueryStates } from "nuqs";
import { useTranslation } from "react-i18next";
import { useViewState } from "@/lib/view-cache";
import { usePhoneLayout } from "@/lib/use-phone-layout";
import { jobFilterParsers, POSTED_DAYS, postedParams, REMOTE_ACCESS } from "@/lib/url-state";
import type { JobSort } from "@/lib/api";
import { useBasedIn } from "@/lib/based-in";
import { CountryFilter } from "@/app/country-filter";
import { pillClasses, PillSelect, PillToggle } from "@/app/pill-controls";
import { TechFilter } from "@/app/tech-filter";
import { TimezonePicker } from "@/app/work-hours";
import { clearViewed, useViewedJobs } from "@/lib/viewed";
import { useUserTimezone } from "@/lib/user-timezone";
import { jobFitsHours, shortZoneName } from "@/lib/work-hours";
import { MobileFilterBar } from "@/app/mobile-filters";

type PostedDays = (typeof POSTED_DAYS)[number];
type RemoteAccessMode = (typeof REMOTE_ACCESS)[number];

/** "Posted within" options (Slack: past hour, today, 3 days, 7 days, 1 month). "" = any. */
export function usePostedOptions(): { value: string; label: string }[] {
  const { t } = useTranslation("home");
  return [
    { value: "", label: t("filters.postedAny") },
    { value: "1h", label: t("filters.postedHour") },
    { value: "today", label: t("filters.postedToday") },
    { value: "3", label: t("filters.posted3") },
    { value: "7", label: t("filters.posted7") },
    { value: "30", label: t("filters.postedMonth") },
  ];
}

/** Sort options for the list (`GET /api/jobs` / `GET /api/feed` `sort=`). "Best match" needs a CV
 * score, so only the signed-in "For you" feed offers it. */
export function useSortOptions(matchSort: boolean): { value: JobSort; label: string }[] {
  const { t } = useTranslation("home");
  const { zone } = useUserTimezone();
  return [
    { value: "newest", label: t("filters.sort.newest") },
    ...(matchSort ? [{ value: "match" as const, label: t("filters.sort.match") }] : []),
    { value: "timezone", label: t("filters.sort.timezone", { abbr: shortZoneName(zone) }) },
    { value: "salary", label: t("filters.sort.salary") },
  ];
}

/** Every filter value at once: what the phone filter view edits as a draft and applies together. */
export interface JobFilterValues {
  q: string;
  source: string;
  remoteOnly: boolean;
  country: string;
  tech: string[];
  posted: string;
  access: string;
  hours: [number, number] | null;
  unreadOnly: boolean;
  sort: JobSort;
}

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
  /** Remote region: "" = any, "open" = accepts my country or not stated, "confirmed" = stated and accepts me. */
  access: string;
  setAccess: (v: string) => void;
  /** Candidate's country used by `access` (saved choice, else guessed from the time zone). */
  basedIn: string | null;
  /** Stable key of every applied filter (list cache key / effect deps). */
  key: string;
  /** Query params for `GET /api/jobs` / `GET /api/feed`. */
  params: {
    q?: string;
    source?: string;
    remote?: boolean;
    country?: string;
    tech?: string;
    days?: number;
    hours?: number;
    access?: RemoteAccessMode;
    based_in?: string;
    sort?: JobSort;
    tz?: string;
  };
  /** Filters on (what "Clear all" undoes); the sort is not counted here — see `sortActive`. */
  activeCount: number;
  /** List order. Not a filter: it never empties the list, so it isn't in `activeCount`. */
  sort: JobSort;
  setSort: (v: JobSort) => void;
  /** A non-default sort is chosen (the folded hero and the phone "Filters" badge count it). */
  sortActive: boolean;
  /** This list offers "Best match" (the signed-in feed). */
  matchSort: boolean;
  clear: () => void;
  /** Apply every value in one URL update (phone filter view: Apply). */
  apply: (v: JobFilterValues) => void;
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
export function useJobFilters(prefix: string, { matchSort = false }: { matchSort?: boolean } = {}): JobFilterState {
  const [url, setUrl] = useQueryStates(jobFilterParsers);
  const { q, source, remote: remoteOnly, country, tech, posted, hours, access } = url;
  // `?sort=match` is shared with the feed; the public catalogue can't score jobs, so it shows newest.
  const sort: JobSort = url.sort === "match" && !matchSort ? "newest" : url.sort;
  // The time-zone sort ranks against the viewer's own zone (saved preference, else the browser's).
  const { zone } = useUserTimezone();
  const sortTz = sort === "timezone" ? zone : "";
  const { country: basedIn } = useBasedIn();
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
    access: access ?? "",
    setAccess: (v) =>
      void setUrl({ access: (REMOTE_ACCESS as readonly string[]).includes(v) ? (v as RemoteAccessMode) : null }),
    basedIn,
    key: JSON.stringify([
      q,
      source,
      remoteOnly,
      country,
      techKey,
      postedValue,
      access ?? "",
      access ? basedIn : "",
      sort,
      sortTz,
    ]),
    params: {
      q: q || undefined,
      source: source || undefined,
      remote: remoteOnly || undefined,
      country: country || undefined,
      tech: techKey || undefined,
      ...postedParams(posted),
      ...(access ? { access, based_in: basedIn ?? undefined } : {}),
      ...(sort !== "newest" ? { sort } : {}),
      ...(sortTz ? { tz: sortTz } : {}),
    },
    activeCount: [q, source, remoteOnly, country, posted, hours, access].filter(Boolean).length + tech.length,
    sort,
    setSort: (v) => void setUrl({ sort: v }),
    sortActive: sort !== "newest",
    matchSort,
    hours,
    setHours: (v) => void setUrl({ hours: v }),
    hiddenIds: hidden ? new Set(hidden) : null,
    setUnreadOnly: (on: boolean) => setHidden(on ? [...viewed] : null),
    clear: () => {
      setDraftQ("");
      setHidden(null);
      void setUrl(null);
    },
    apply: (v) => {
      // The search box follows at once, so its debounce has nothing left to write.
      setDraftQ(v.q);
      if ((hidden !== null) !== v.unreadOnly) setHidden(v.unreadOnly ? [...viewed] : null);
      void setUrl({
        q: v.q,
        source: v.source,
        remote: v.remoteOnly,
        country: v.country,
        tech: v.tech,
        posted: (POSTED_DAYS as readonly string[]).includes(v.posted) ? (v.posted as PostedDays) : null,
        access: (REMOTE_ACCESS as readonly string[]).includes(v.access) ? (v.access as RemoteAccessMode) : null,
        hours: v.hours,
        sort: v.sort,
      });
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

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** One-tap ranges next to the hours slider (no drag-only control). */
export function useHourPresets(): { label: string; value: [number, number] }[] {
  const { t } = useTranslation("home");
  return [
    { label: t("filters.hours.presetOffice"), value: [9, 17] },
    { label: t("filters.hours.presetEarly"), value: [6, 14] },
    { label: t("filters.hours.presetLate"), value: [13, 22] },
    { label: t("filters.hours.presetEvening"), value: [18, 24] },
  ];
}

/**
 * "Hours" pill (Slack request: "a filter to drag my preferred hours"): a two-thumb slider on the
 * user's own clock. Keeps jobs whose 9–5 overlaps the chosen hours by at least 4h (or the whole
 * window when it is shorter); jobs with no stated time zone always stay.
 */
function HoursFilter({ value, onChange }: { value: [number, number] | null; onChange: (v: [number, number] | null) => void }) {
  const { t } = useTranslation("home");
  const HOUR_PRESETS = useHourPresets();
  const { zone } = useUserTimezone();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<[number, number]>(value ?? [9, 17]);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const abbr = shortZoneName(zone);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
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
        ref={triggerRef}
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
        {value ? `${hourLabel(value[0])}–${hourLabel(value[1])} ${abbr}` : t("filters.hours.pill")}
      </button>
      <FloatingPanel
        anchorRef={triggerRef}
        open={open}
        panelRef={panelRef}
        id={panelId}
        role="dialog"
        aria-label={t("filters.hours.panelTitle")}
        className="w-80 rounded-[18px] border border-separator bg-background p-4 shadow-overlay"
      >
          <p className="text-headline text-label">{t("filters.hours.panelTitle")}</p>
          <p className="mt-0.5 text-footnote text-label-secondary">{t("filters.hours.description", { abbr })}</p>
          <p className="mt-3 text-title3 font-semibold text-label tabular-nums">
            {hourLabel(draft[0])} – {hourLabel(draft[1])}
          </p>
          <RangeSlider
            className="mt-2"
            labels={[t("filters.hours.startOfDay"), t("filters.hours.endOfDay")]}
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
              {t("filters.hours.anyHours")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-label px-4 py-1.5 text-subheadline font-semibold text-background focus-ring"
            >
              {t("filters.hours.done")}
            </button>
          </div>
      </FloatingPanel>
    </div>
  );
}

/** "Read 42 jobs · Clear" — the read history kept in this browser (and the account). */
export function ReadHistory() {
  const { t } = useTranslation("home");
  const viewed = useViewedJobs();
  const [clearing, setClearing] = useState(false);
  return (
    <p className="flex items-center gap-2 text-subheadline text-label-secondary">
      {t("filters.readHistory", { count: viewed.size })}
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
          {t("filters.clearReadHistory")}
        </button>
      ) : null}
    </p>
  );
}

export interface JobFilterBarProps {
  filters: JobFilterState;
  /** Source ids to offer in the Source select. */
  sources: readonly string[];
  /** Extra controls at the end of the bar (feed: Refresh scores). */
  extra?: ReactNode;
}

/**
 * Home filter bar. Phones (< 768px) get one "Filters" button that opens a single modal view
 * (`MobileFilterBar`); wider screens keep the pill bar below.
 */
export function JobFilterBar(props: JobFilterBarProps) {
  return usePhoneLayout() ? <MobileFilterBar {...props} /> : <DesktopFilterBar {...props} />;
}

/**
 * Home filter bar (Slack requests: "the filter area takes too much room", then "looks like an admin
 * tool"): one big search pill like a job site, and a single row of filter pills under it — source,
 * country, posted-within, remote, unread and "More filters". Tech chips and the time-zone picker
 * open in a panel underneath only when asked for. Selected techs stay visible as small chips.
 */
function DesktopFilterBar({ filters: f, sources, extra }: JobFilterBarProps) {
  const { t } = useTranslation("home");
  const postedOptions = usePostedOptions();
  const sortOptions = useSortOptions(f.matchSort);
  const strings = useUiStrings();
  // Native <option> text can't hold markup: flag emoji + short country code ("🇻🇳 VN").
  const accessYou = f.basedIn ? `${flagEmoji(f.basedIn)} ${countryName(f.basedIn, strings.locale)}` : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-3">
      {/* Search on its own line, the filter pills under it (phones: one sideways-scrolling row). */}
      <div className="flex flex-col gap-2.5">
        <SearchField
          variant="hero"
          value={f.draftQ}
          onChange={f.setDraftQ}
          label={t("filters.searchLabel")}
          placeholder={t("filters.searchPlaceholder")}
          className="w-full md:max-w-2xl"
        />
        <div className="-mx-4 -my-1 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0 [&::-webkit-scrollbar]:hidden">
        <PillSelect label={t("filters.sourceLabel")} value={f.source} onChange={f.setSource}>
          <option value="">{t("filters.allSources")}</option>
          {sources.map((id) => (
            <option key={id} value={id}>
              {sourceMeta(id).label}
            </option>
          ))}
        </PillSelect>
        <CountryFilter value={f.country} onChange={f.setCountry} compact />
        <PillSelect label={t("filters.postedLabel")} value={f.posted} onChange={f.setPosted}>
          {postedOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </PillSelect>
        <PillToggle
          label={t("common:ui.remote")}
          checked={f.remoteOnly}
          onChange={f.setRemoteOnly}
          icon={<GlobeIcon size={15} strokeWidth={2} aria-hidden />}
        />
        {/* One tap for the common case: hide jobs whose remote region excludes the candidate
            (keeps "not stated"). The select next to it keeps the stricter "confirmed" option. */}
        <PillToggle
          label={t("filters.access.onlyMine")}
          checked={f.access !== ""}
          onChange={(on) => f.setAccess(on ? "open" : "")}
          icon={
            f.basedIn ? (
              <span aria-hidden className="text-[0.95rem] leading-none">
                {flagEmoji(f.basedIn)}
              </span>
            ) : undefined
          }
        />
        <PillSelect label={t("filters.access.label")} value={f.access} onChange={f.setAccess}>
          <option value="">{t("filters.access.any")}</option>
          <option value="open">{accessYou ? t("filters.access.open", { you: accessYou }) : t("filters.access.openWorldwide")}</option>
          <option value="confirmed">
            {accessYou ? t("filters.access.confirmed", { you: accessYou }) : t("filters.access.confirmedWorldwide")}
          </option>
        </PillSelect>
        <HoursFilter value={f.hours} onChange={f.setHours} />
        <PillToggle label={t("filters.unread")} checked={f.hiddenIds !== null} onChange={f.setUnreadOnly} />
        <PillSelect
          label={t("filters.sort.label")}
          // "" = the default order, so the pill stays untinted until another order is picked.
          value={f.sortActive ? f.sort : ""}
          onChange={(v) => f.setSort((v || "newest") as JobSort)}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value === "newest" ? "" : o.value}>
              {o.label}
            </option>
          ))}
        </PillSelect>
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((o) => !o)}
          className={cx(pillClasses(moreOpen || f.tech.length > 0), "px-3.5")}
        >
          <SlidersIcon size={15} strokeWidth={2} aria-hidden />
          {f.tech.length ? t("filters.moreFiltersCount", { count: f.tech.length }) : t("filters.moreFilters")}
        </button>
        {!moreOpen
          ? f.tech.map((id) => (
              <Chip
                key={id}
                onRemove={() => f.setTech(f.tech.filter((techId) => techId !== id))}
                removeLabel={t("common:ui.remove")}
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
            {t("filters.clearAll")}
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

/** One line for the folded home hero: what is being searched and how many filters are on. */
export function JobFilterSummary({ filters }: { filters: JobFilterState }) {
  const { t } = useTranslation("home");
  const query = filters.draftQ.trim();
  const count = filters.activeCount + (filters.sortActive ? 1 : 0);
  return (
    <>
      <SearchIcon size={16} strokeWidth={2.25} aria-hidden className="shrink-0" />
      <span className={cx("truncate", query ? "font-semibold text-label" : "font-medium")}>
        {query ? `“${query}”` : t("filters.collapsedAll")}
      </span>
      {count ? (
        <span className="shrink-0 rounded-full bg-tint-soft px-2 py-0.5 text-caption font-semibold text-tint-ink">
          {t("filters.collapsedFilters", { count })}
        </span>
      ) : null}
      <span className="sr-only">{t("filters.collapsedEdit")}</span>
    </>
  );
}
