"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card, Chip, cx, ExternalLinkIcon, NavBar, SparklesIcon } from "@ujc/ui";
import type { Tone } from "@ujc/ui";
import { AccountMenu } from "@/app/nav";
import { useLanguage } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n";
import {
  activitySince,
  heatmapWeeks,
  isoDay,
  RELEASE_CATEGORIES,
  RELEASE_NOTES,
} from "@/lib/release-notes";
import type { HeatmapDay, ReleaseCategory, ReleaseEntry } from "@/lib/release-notes";
import { REPO_URL } from "@/lib/site";

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
} as const;

function TrendingUpIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2-2 6.6-6.6a4 4 0 0 1-5-5zM14.7 6.3 17 4M9 15l-6 6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg {...ICON_PROPS} width={16} height={16}>
      <path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

const CATEGORY_STYLE: Record<ReleaseCategory, { tone: Tone; icon: ReactNode }> = {
  new: { tone: "tint", icon: <SparklesIcon size={14} strokeWidth={2} /> },
  improved: { tone: "info", icon: <TrendingUpIcon /> },
  fixed: { tone: "success", icon: <WrenchIcon /> },
  "under-the-hood": { tone: "neutral", icon: <GearIcon /> },
};

const HEAT_CLASS: Record<HeatmapDay["level"], string> = {
  0: "bg-fill-secondary",
  1: "bg-tint/30",
  2: "bg-tint/55",
  3: "bg-tint/80",
  4: "bg-tint",
};

/** `2026-11-07` in the reader's language ("Nov 7, 2026" / "7 thg 11, 2026"). */
export function formatDay(day: string, locale: string, withYear = true): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

const subscribeNever = () => () => {};

/**
 * Today's date for the activity window: the build day while prerendering and hydrating, then the
 * visitor's own day (a static page can sit for days between rebuilds).
 */
function useToday(builtAt: string): string {
  return useSyncExternalStore(
    subscribeNever,
    () => isoDay(new Date()),
    () => builtAt.slice(0, 10),
  );
}

function pick(text: { en: string; vi: string }, language: Language): string {
  return text[language] || text.en;
}

/**
 * `/release-notes/`: public timeline of what shipped, one entry per day (or per release), newest
 * first, with an activity summary and a contribution-style strip of commit days. Text comes from
 * `src/content/release-notes.json` (AI-written on every push to main, see docs/DEVELOPMENT.md).
 */
export function ReleaseNotesPage({ builtAt, entries = RELEASE_NOTES.entries }: { builtAt: string; entries?: ReleaseEntry[] }) {
  const { t } = useTranslation("releaseNotes");
  const { language, dateLocale } = useLanguage();
  const today = useToday(builtAt);
  const [category, setCategory] = useState<ReleaseCategory | null>(null);

  const activity = useMemo(() => activitySince(entries, today), [entries, today]);
  const weeks = useMemo(() => heatmapWeeks(entries, today), [entries, today]);
  const visible = useMemo(
    () =>
      entries
        .map((entry) => ({ entry, highlights: entry.highlights.filter((h) => !category || h.category === category) }))
        .filter((e) => e.highlights.length > 0),
    [entries, category],
  );
  const latest = entries[0];

  return (
    <>
      <NavBar
        title={t("title")}
        trailing={
          <div className="flex items-center gap-2">
            <a
              href="/release-notes/feed.xml"
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-subheadline font-medium text-tint hover:bg-fill-tertiary focus-ring"
            >
              <RssIcon />
              <span className="sr-only sm:not-sr-only">{t("feed")}</span>
            </a>
            <div className="md:hidden">
              <AccountMenu />
            </div>
          </div>
        }
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-24 sm:px-6">
        <p className="max-w-2xl text-callout text-label-secondary">{t("subtitle")}</p>

        <Card padding="none" className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-footnote font-semibold tracking-wide text-label-secondary uppercase">{t("activity.label")}</p>
            <p className="mt-1 font-display text-title2 font-bold tracking-[-0.02em] text-label" data-testid="activity-updates">
              {t("activity.updates", { count: activity.updates })}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-subheadline text-label-secondary">
              <span>{t("activity.days", { count: activity.days })}</span>
              <span aria-hidden>·</span>
              <span>{t("activity.commits", { count: activity.commits })}</span>
            </p>
            {latest ? (
              <p className="mt-0.5 text-footnote text-label-tertiary">
                {t("activity.lastUpdate", { date: formatDay(latest.date, dateLocale) })}
              </p>
            ) : null}
          </div>
          <Heatmap weeks={weeks} />
        </Card>

        <div role="group" aria-label={t("filter.label")} className="flex flex-wrap gap-2">
          <Chip selected={category === null} onClick={() => setCategory(null)}>
            {t("filter.all")}
          </Chip>
          {RELEASE_CATEGORIES.map((c) => (
            <Chip key={c} selected={category === c} onClick={() => setCategory(category === c ? null : c)} icon={CATEGORY_STYLE[c].icon}>
              {t(`category.${c}`)}
            </Chip>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="text-callout text-label-secondary">{t("empty")}</p>
        ) : (
          <ol className="relative flex flex-col gap-8 border-l border-separator pl-5 sm:ml-28 sm:pl-6">
            {visible.map(({ entry, highlights }) => (
              <EntryItem
                key={entry.slug}
                entry={entry}
                highlights={highlights}
                isLatest={entry === latest}
                language={language}
                dateLocale={dateLocale}
              />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function EntryItem({
  entry,
  highlights,
  isLatest,
  language,
  dateLocale,
}: {
  entry: ReleaseEntry;
  highlights: ReleaseEntry["highlights"];
  isLatest: boolean;
  language: Language;
  dateLocale: string;
}) {
  const { t } = useTranslation("releaseNotes");
  const date = formatDay(entry.date, dateLocale);
  const titleId = `release-${entry.slug}-title`;
  return (
    <li id={entry.slug} aria-labelledby={titleId} className="relative scroll-mt-28">
      {/* Timeline dot on the rail; the date sits left of the rail on wide screens. */}
      <span
        aria-hidden
        className={cx(
          "absolute top-1.5 -left-[calc(1.25rem+5px)] size-2.5 rounded-full ring-4 ring-background sm:-left-[calc(1.5rem+5px)]",
          isLatest ? "bg-tint" : "bg-label-tertiary",
        )}
      />
      <time
        dateTime={entry.date}
        className="mb-1 block text-footnote font-semibold text-label-secondary sm:absolute sm:top-0.5 sm:-left-[8.5rem] sm:mb-0 sm:w-24 sm:text-right"
      >
        {date}
      </time>
      <Card padding="none" className={cx("p-4 sm:p-5", isLatest && "ring-2 ring-tint/40")}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="text-headline font-semibold text-label">
            <a href={`#${entry.slug}`} className="rounded-control-sm hover:underline focus-ring">
              {pick(entry.title, language)}
            </a>
          </h2>
          {isLatest ? (
            <Badge tone="tint" variant="solid">
              {t("latest")}
            </Badge>
          ) : null}
        </div>
        <ul className="mt-3 flex flex-col gap-2.5">
          {highlights.map((h, i) => (
            <li key={i} className="flex flex-col items-start gap-1 sm:flex-row sm:gap-3">
              <Badge tone={CATEGORY_STYLE[h.category].tone} icon={CATEGORY_STYLE[h.category].icon} className="sm:mt-px sm:w-32 sm:justify-start">
                {t(`category.${h.category}`)}
              </Badge>
              <span className="min-w-0 text-callout text-label">{pick(h, language)}</span>
            </li>
          ))}
        </ul>
        {entry.screenshot ? (
          // eslint-disable-next-line @next/next/no-img-element -- static export, images are unoptimized anyway
          <img
            src={entry.screenshot}
            alt={t("screenshotAlt", { date })}
            loading="lazy"
            decoding="async"
            className="mt-4 w-full rounded-control border border-separator"
          />
        ) : null}
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-tertiary">
          <span>{t("commits", { count: entry.commits.count })}</span>
          <a
            href={`${REPO_URL}/commits/${entry.commits.to}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-control-sm font-medium text-tint hover:underline focus-ring"
          >
            {t("viewCode")}
            <ExternalLinkIcon size={12} />
          </a>
        </p>
      </Card>
    </li>
  );
}

function Heatmap({ weeks }: { weeks: HeatmapDay[][] }) {
  const { t } = useTranslation("releaseNotes");
  const { dateLocale } = useLanguage();
  const label = (d: HeatmapDay) => {
    const date = formatDay(d.date, dateLocale);
    return d.commits ? t("activity.dayCommits", { date, count: d.commits }) : t("activity.dayNone", { date });
  };
  return (
    <figure className="flex shrink-0 flex-col gap-1.5">
      <div role="img" aria-label={t("activity.heatmap")} className="flex gap-[3px]">
        {weeks.map((week) => (
          <div key={week[0].date} className="flex flex-col gap-[3px]">
            {week.map((d) => (
              <span
                key={d.date}
                title={d.future ? undefined : label(d)}
                data-level={d.future ? undefined : d.level}
                className={cx("size-3 rounded-[3px]", d.future ? "bg-transparent" : HEAT_CLASS[d.level])}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="flex items-center justify-between gap-2 text-caption text-label-tertiary">
        <span>{t("activity.heatmap")}</span>
        <span className="flex items-center gap-1" aria-hidden>
          {t("activity.less")}
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <span key={l} className={cx("size-2.5 rounded-[2px]", HEAT_CLASS[l])} />
          ))}
          {t("activity.more")}
        </span>
      </figcaption>
    </figure>
  );
}
