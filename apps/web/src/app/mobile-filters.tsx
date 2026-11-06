"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { sourceMeta, techInfo } from "@ujc/core";
import {
  buttonClasses,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  countryKeywords,
  countryName,
  cx,
  fuzzyFilter,
  IconButton,
  ModalView,
  RangeSlider,
  SearchField,
  SlidersIcon,
  TechIcon,
  Toggle,
  useToast,
  useUiStrings,
} from "@ujc/ui";
import type { ModalViewHandle } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { getJobFacets } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useUserTimezone } from "@/lib/user-timezone";
import { shortZoneName } from "@/lib/work-hours";
import { useTechGroups } from "@/app/tech-filter";
import { timezoneSelectOptions } from "@/app/work-hours";
import { pillClasses } from "@/app/pill-controls";
import type { JobFilterBarProps, JobFilterState, JobFilterValues } from "@/app/job-filters";
import { hourLabel, ReadHistory, useHourPresets, usePostedOptions, useSortOptions } from "@/app/job-filters";

/** What a parent may do with the phone filter view. */
export interface FilterModalHandle {
  open: () => void;
  close: () => void;
}

type Step = "list" | "source" | "country" | "tech" | "timezone";

const DEFAULT_HOURS: [number, number] = [9, 17];

function valuesOf(f: JobFilterState): JobFilterValues {
  return {
    // What the search pill shows, even if its 300 ms debounce hasn't reached the URL yet.
    q: f.draftQ,
    source: f.source,
    remoteOnly: f.remoteOnly,
    country: f.country,
    tech: f.tech,
    posted: f.posted,
    access: f.access,
    hours: f.hours,
    unreadOnly: f.hiddenIds !== null,
    sort: f.sort,
  };
}

const EMPTY: JobFilterValues = {
  q: "",
  source: "",
  remoteOnly: false,
  country: "",
  tech: [],
  posted: "",
  access: "",
  hours: null,
  unreadOnly: false,
  sort: "newest",
};

/**
 * Phone filter bar (< 768px): the search pill and ONE "Filters" button with the number of filters
 * on. Every other filter lives in `FilterModal` — no sideways-scrolling pill row, no popover per
 * pill. `extra` (feed: Refresh scores) wraps under the search.
 */
export function MobileFilterBar({ filters: f, sources, extra }: JobFilterBarProps) {
  const { t } = useTranslation("home");
  const modalRef = useRef<FilterModalHandle>(null);
  // The search pill is visible next to the button, so the badge counts only what is inside the view.
  const count = f.activeCount - (f.q ? 1 : 0) + (f.hiddenIds !== null ? 1 : 0) + (f.sortActive ? 1 : 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <SearchField
          variant="hero"
          value={f.draftQ}
          onChange={f.setDraftQ}
          label={t("filters.searchLabel")}
          placeholder={t("filters.searchPlaceholder")}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={count ? t("filters.mobile.buttonLabel", { count }) : t("filters.mobile.button")}
          onClick={() => modalRef.current?.open()}
          className={cx(pillClasses(count > 0), "h-12 px-4")}
        >
          <SlidersIcon size={16} strokeWidth={2} aria-hidden />
          {t("filters.mobile.button")}
          {count ? (
            <span
              aria-hidden
              className="inline-flex size-5 items-center justify-center rounded-full bg-tint text-caption font-semibold text-on-tint tabular-nums"
            >
              {count}
            </span>
          ) : null}
        </button>
      </div>
      {extra ? <div className="flex flex-wrap items-center gap-2">{extra}</div> : null}
      <FilterModal ref={modalRef} filters={f} sources={sources} />
    </div>
  );
}

/** A 44px option chip (the kit's `Chip` is 32px, sized for pointer screens). `radio` = one of a
 * set (inside a `role="radiogroup"`); otherwise a toggle (several may be on). */
function Choice({
  selected,
  onClick,
  radio = false,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  radio?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      onClick={onClick}
      className={cx(
        "inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-subheadline font-medium transition-colors duration-200 focus-ring",
        selected ? "bg-tint text-on-tint" : "bg-fill-tertiary text-label hover:bg-fill-secondary",
      )}
    >
      {children}
    </button>
  );
}

/** "Country — Germany ›": opens a step inside the same view. */
function StepRow({ step, label, value, onOpen }: { step: Step; label: string; value: string; onOpen: (s: Step) => void }) {
  return (
    <button
      type="button"
      data-step={step}
      onClick={() => onOpen(step)}
      className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left text-body text-label transition-colors duration-150 hover:bg-fill-tertiary focus-ring"
    >
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-label-secondary">{value}</span>
      <ChevronRightIcon size={16} aria-hidden className="shrink-0 text-label-tertiary" />
    </button>
  );
}

/** A switch row: the whole row is the label of the `Toggle`. */
function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3">
      <span className="text-body text-label">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-footnote font-semibold tracking-wide text-label-secondary uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** One option of a single-choice step list; picking it returns to the filters. */
function OptionRow({ selected, onPick, hint, icon, children }: {
  selected: boolean;
  onPick: () => void;
  hint?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onPick}
        className={cx(
          "flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left text-body transition-colors duration-150 hover:bg-fill-tertiary focus-ring",
          selected ? "font-semibold text-tint-ink" : "text-label",
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {hint ? <span className="shrink-0 text-footnote text-label-tertiary tabular-nums">{hint}</span> : null}
        {selected ? <CheckIcon size={16} strokeWidth={2.5} aria-hidden className="shrink-0" /> : <span className="size-4 shrink-0" />}
      </button>
    </li>
  );
}

/**
 * The phone filter view: one modal holding every home filter, opened through its handle. It edits
 * a draft — the list behind does not change while you choose — and Apply writes the URL once.
 * Long lists (source, country, time zone, tech) are steps inside the same view, never a popover.
 * There is no result count: `GET /api/jobs` returns no total, and counting a draft would cost a
 * list request per tap.
 */
export function FilterModal({
  ref,
  filters: f,
  sources,
}: {
  ref?: Ref<FilterModalHandle>;
  filters: JobFilterState;
  sources: readonly string[];
}) {
  const { t } = useTranslation("home");
  const strings = useUiStrings();
  const postedOptions = usePostedOptions();
  const sortOptions = useSortOptions(f.matchSort);
  const hourPresets = useHourPresets();
  const { zone, setZone } = useUserTimezone();
  const toast = useToast();
  const { data: facets } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const view = useRef<ModalViewHandle>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<JobFilterValues>(() => valuesOf(f));
  const [draftZone, setDraftZone] = useState(zone);
  const [step, setStep] = useState<Step>("list");
  const [lastStep, setLastStep] = useState<Step>("list");
  const [search, setSearch] = useState("");
  const set = (patch: Partial<JobFilterValues>) => setDraft((d) => ({ ...d, ...patch }));

  useImperativeHandle(ref, () => ({ open: () => view.current?.open(), close: () => view.current?.close() }), []);

  const go = (next: Step) => {
    setLastStep(next);
    setSearch("");
    setStep(next);
  };

  // Moving between steps swaps the body: start a step at its top with focus on its first control,
  // and come back to the row that opened it.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (step === "list") {
      body.querySelector<HTMLElement>(`[data-step="${lastStep}"]`)?.focus();
    } else {
      body.parentElement?.scrollTo?.({ top: 0 });
      body.querySelector<HTMLElement>("input, button")?.focus();
    }
  }, [step, lastStep]);

  const accessYou = f.basedIn ? countryName(f.basedIn, strings.locale) : null;
  const facetCountries = facets?.countries ?? [];
  const countries = [
    ...(draft.country && !facetCountries.some((c) => c.code === draft.country) ? [{ code: draft.country, count: 0 }] : []),
    ...facetCountries,
  ];
  const zones = useMemo(() => (step === "timezone" ? timezoneSelectOptions(draftZone) : []), [step, draftZone]);
  const tech = useTechGroups(draft.tech, step === "tech" ? search : "");

  const titles: Record<Step, string> = {
    list: t("filters.mobile.title"),
    source: t("filters.sourceLabel"),
    country: t("country.label"),
    tech: t("filters.mobile.tech"),
    timezone: t("workHours.yourTimeZone"),
  };

  const apply = () =>
    view.current?.close(() => {
      f.apply(draft);
      if (draftZone !== zone) {
        void setZone(draftZone).catch(() =>
          toast.show({ tone: "error", title: t("filters.mobile.zoneError") }),
        );
      }
    });

  let body: ReactNode;
  if (step === "source") {
    body = (
      <ul role="radiogroup" aria-label={titles[step]} className="flex flex-col">
        {["", ...sources].map((id) => (
          <OptionRow
            key={id || "all"}
            selected={draft.source === id}
            onPick={() => {
              set({ source: id });
              setStep("list");
            }}
          >
            {id ? sourceMeta(id).label : t("filters.allSources")}
          </OptionRow>
        ))}
      </ul>
    );
  } else if (step === "country") {
    const options = fuzzyFilter(
      [{ code: "", count: 0 }, ...countries],
      search,
      (c) => (c.code ? [countryName(c.code, strings.locale), ...countryKeywords(c.code)] : t("country.allCountries")),
    );
    body = (
      <div className="flex flex-col gap-2">
        <SearchField value={search} onChange={setSearch} label={t("country.searchPlaceholder")} placeholder={t("country.searchPlaceholder")} />
        <ul role="radiogroup" aria-label={titles[step]} className="flex flex-col">
          {options.length === 0 ? <li className="px-3 py-2 text-body text-label-secondary">{strings.noMatches}</li> : null}
          {options.map((c) => (
            <OptionRow
              key={c.code || "all"}
              selected={draft.country === c.code}
              hint={c.count ? c.count.toLocaleString(strings.locale) : undefined}
              onPick={() => {
                set({ country: c.code });
                setStep("list");
              }}
            >
              {c.code ? countryName(c.code, strings.locale) : t("country.allCountries")}
            </OptionRow>
          ))}
        </ul>
      </div>
    );
  } else if (step === "timezone") {
    // Every zone (~420), never cut off: "Asia/Ho Chi Minh" sits past the 200th row alphabetically.
    const options = fuzzyFilter(zones, search, (z) => [z.label, ...(Array.isArray(z.keywords) ? z.keywords : [])]);
    body = (
      <div className="flex flex-col gap-2">
        <SearchField value={search} onChange={setSearch} label={t("workHours.searchPlaceholder")} placeholder={t("workHours.searchPlaceholder")} />
        <ul role="radiogroup" aria-label={titles[step]} className="flex flex-col">
          {options.length === 0 ? <li className="px-3 py-2 text-body text-label-secondary">{strings.noMatches}</li> : null}
          {options.map((z) => (
            <OptionRow
              key={z.value}
              selected={draftZone === z.value}
              hint={z.hint}
              onPick={() => {
                setDraftZone(z.value);
                setStep("list");
              }}
            >
              {z.label}
            </OptionRow>
          ))}
        </ul>
      </div>
    );
  } else if (step === "tech") {
    const toggle = (id: string) =>
      set({ tech: draft.tech.includes(id) ? draft.tech.filter((v) => v !== id) : [...draft.tech, id] });
    body = (
      <div className="flex flex-col gap-5">
        <SearchField value={search} onChange={setSearch} label={t("tech.searchLabel")} placeholder={t("tech.searchPlaceholder")} />
        {search && tech.groups.length === 0 ? <p className="px-1 text-body text-label-secondary">{strings.noMatches}</p> : null}
        {tech.groups.map(({ category, label, ids }) => {
          return (
            <Section key={category} title={label}>
              <div role="group" aria-label={`${label} tech`} className="flex flex-wrap gap-2">
                {ids.map((id) => (
                  <Choice key={id} selected={draft.tech.includes(id)} onClick={() => toggle(id)}>
                    <span className="inline-flex rounded-[5px] bg-white/90 p-0.5">
                      <TechIcon id={id} size={14} />
                    </span>
                    {techInfo(id).label}
                  </Choice>
                ))}
              </div>
            </Section>
          );
        })}
      </div>
    );
  } else {
    const hoursOn = draft.hours !== null;
    const hours = draft.hours ?? DEFAULT_HOURS;
    body = (
      <div className="flex flex-col gap-6">
        <Section title={t("filters.mobile.keywords")}>
          <SearchField
            value={draft.q}
            onChange={(q) => set({ q })}
            label={t("filters.searchLabel")}
            placeholder={t("filters.searchPlaceholder")}
          />
        </Section>
        <Section title={t("filters.sort.label")}>
          <div role="radiogroup" aria-label={t("filters.sort.label")} className="flex flex-wrap gap-2">
            {sortOptions.map((o) => (
              <Choice key={o.value} radio selected={draft.sort === o.value} onClick={() => set({ sort: o.value })}>
                {o.label}
              </Choice>
            ))}
          </div>
        </Section>
        <Section title={t("filters.mobile.where")}>
          <div className="flex flex-col rounded-card bg-background">
            <StepRow
              step="source"
              label={t("filters.sourceLabel")}
              value={draft.source ? sourceMeta(draft.source).label : t("filters.allSources")}
              onOpen={go}
            />
            <StepRow
              step="country"
              label={t("country.label")}
              value={draft.country ? countryName(draft.country, strings.locale) : t("country.allCountries")}
              onOpen={go}
            />
          </div>
        </Section>
        <Section title={t("filters.postedLabel")}>
          <div role="radiogroup" aria-label={t("filters.postedLabel")} className="flex flex-wrap gap-2">
            {postedOptions.map((o) => (
              <Choice key={o.value || "any"} radio selected={draft.posted === o.value} onClick={() => set({ posted: o.value })}>
                {o.label}
              </Choice>
            ))}
          </div>
        </Section>
        <Section title={t("filters.mobile.remote")}>
          <div className="rounded-card bg-background py-1">
            <SwitchRow label={t("filters.mobile.remoteOnly")} checked={draft.remoteOnly} onChange={(remoteOnly) => set({ remoteOnly })} />
          </div>
          <div role="radiogroup" aria-label={t("filters.access.label")} className="flex flex-wrap gap-2">
            <Choice radio selected={draft.access === ""} onClick={() => set({ access: "" })}>
              {t("filters.access.any")}
            </Choice>
            <Choice radio selected={draft.access === "open"} onClick={() => set({ access: "open" })}>
              {accessYou ? t("filters.access.open", { you: accessYou }) : t("filters.access.openWorldwide")}
            </Choice>
            <Choice radio selected={draft.access === "confirmed"} onClick={() => set({ access: "confirmed" })}>
              {accessYou ? t("filters.access.confirmed", { you: accessYou }) : t("filters.access.confirmedWorldwide")}
            </Choice>
          </div>
        </Section>
        <Section title={t("filters.hours.panelTitle")}>
          <div className="flex flex-col rounded-card bg-background py-1">
            <SwitchRow
              label={t("filters.hours.panelTitle")}
              checked={hoursOn}
              onChange={(on) => set({ hours: on ? DEFAULT_HOURS : null })}
            />
            {hoursOn ? (
              <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
                <p className="text-footnote text-label-secondary">
                  {t("filters.hours.description", { abbr: shortZoneName(draftZone) })}
                </p>
                <p className="text-title3 font-semibold text-label tabular-nums">
                  {hourLabel(hours[0])} – {hourLabel(hours[1])}
                </p>
                <RangeSlider
                  labels={[t("filters.hours.startOfDay"), t("filters.hours.endOfDay")]}
                  min={0}
                  max={24}
                  value={hours}
                  onChange={(v) => set({ hours: v })}
                  format={hourLabel}
                />
                <div role="radiogroup" aria-label={t("filters.hours.panelTitle")} className="flex flex-wrap gap-2">
                  {hourPresets.map((p) => (
                    <Choice
                      key={p.label}
                      radio
                      selected={hours[0] === p.value[0] && hours[1] === p.value[1]}
                      onClick={() => set({ hours: p.value })}
                    >
                      {p.label}
                    </Choice>
                  ))}
                </div>
              </div>
            ) : null}
            <StepRow step="timezone" label={t("workHours.yourTimeZone")} value={draftZone.replace(/_/g, " ")} onOpen={go} />
          </div>
        </Section>
        <Section title={t("filters.mobile.tech")}>
          <div className="rounded-card bg-background">
            <StepRow
              step="tech"
              label={t("filters.mobile.tech")}
              value={
                draft.tech.length
                  ? draft.tech.map((id) => techInfo(id).label).join(", ")
                  : t("filters.mobile.techAny")
              }
              onOpen={go}
            />
          </div>
        </Section>
        <Section title={t("filters.mobile.reading")}>
          <div className="flex flex-col gap-1 rounded-card bg-background py-1">
            <SwitchRow label={t("filters.mobile.unreadOnly")} checked={draft.unreadOnly} onChange={(unreadOnly) => set({ unreadOnly })} />
            {/* Its "Clear" is a text link on desktop; here it gets a 44px row. */}
            <div className="px-3 pb-1 [&_button]:min-h-11">
              <ReadHistory />
            </div>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <ModalView
      ref={view}
      size="tall"
      title={titles[step]}
      closeLabel={strings.close}
      onOpen={() => {
        setDraft(valuesOf(f));
        setDraftZone(zone);
        setStep("list");
        setLastStep("list");
      }}
      onBack={step === "list" ? undefined : () => setStep("list")}
      leading={
        step === "list" ? undefined : (
          <IconButton
            label={t("filters.mobile.back")}
            icon={<ChevronLeftIcon size={18} strokeWidth={2.5} />}
            variant="gray"
            size="sm"
            onClick={() => setStep("list")}
          />
        )
      }
      footer={
        step === "list" ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY);
                setDraftZone(zone);
              }}
              className={buttonClasses({ variant: "gray", size: "lg", className: "flex-1" })}
            >
              {t("filters.mobile.reset")}
            </button>
            <button type="button" onClick={apply} className={buttonClasses({ size: "lg", className: "flex-[2]" })}>
              {t("filters.mobile.show")}
            </button>
          </div>
        ) : step === "tech" ? (
          <button type="button" onClick={() => setStep("list")} className={buttonClasses({ size: "lg", fullWidth: true })}>
            {t("filters.mobile.done")}
          </button>
        ) : undefined
      }
    >
      {/* The title changes in place when a step opens: say so (the dialog name isn't re-read). */}
      <p aria-live="polite" className="sr-only">
        {step === "list" ? "" : titles[step]}
      </p>
      <div ref={bodyRef}>{body}</div>
    </ModalView>
  );
}
