"use client";

/**
 * Loading placeholders for whole screens and their main blocks. Each one copies the layout classes
 * of the component it stands in for (same grid, paddings, radii, avatar sizes, number of lines), so
 * nothing moves when the data arrives. The containers carry `aria-busy` + a translated label; the
 * blocks themselves are decorative (`aria-hidden`).
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  BrandMark,
  JobCardSkeleton,
  JobDetailSkeleton,
  JobListItemSkeleton,
  NavBar,
  Skeleton,
  SkeletonText,
} from "@ujc/ui";
import { useFitToViewport } from "@/app/job-browser";
import { BRAND_NAME } from "@/app/nav";

/* ------------------------------------------------------------------ Home */

/**
 * `JobBrowser` while the first page loads: the same two columns (list + detail panel on `lg`, one
 * column of rows on phones), fitted to the viewport by the same hook, so the loaded browser lands
 * exactly where the placeholder was.
 */
export function JobBrowserSkeleton({ label, rows = 8, actions = false }: { label: string; rows?: number; actions?: boolean }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useFitToViewport(rootRef);
  return (
    <div
      ref={rootRef}
      aria-busy="true"
      aria-label={label}
      data-testid="job-browser-skeleton"
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]"
    >
      {/* `scrollbar-gutter`: the loaded list scrolls, so keep its scrollbar's width free here too. */}
      <div className="lg:-mx-1 lg:min-h-0 lg:overflow-hidden lg:px-1 lg:py-1 lg:[scrollbar-gutter:stable]">
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: rows }, (_, i) => (
            <JobListItemSkeleton key={i} actions={actions} />
          ))}
        </div>
      </div>
      <div className="relative hidden min-h-0 overflow-hidden rounded-[22px] border border-separator bg-background shadow-raised lg:flex lg:flex-col">
        <div className="min-h-0 flex-1 overflow-hidden p-6 [scrollbar-gutter:stable]">
          <JobDetailSkeleton variant="panel" />
        </div>
      </div>
    </div>
  );
}

/** The "11 sources · live" pill (`SourcesSummary`) while `GET /api/sources` is in flight. */
export function SourcesPillSkeleton() {
  return <Skeleton className="h-9 w-[12.5rem] rounded-full pointer-coarse:h-11" />;
}

/** `HomeHero` + `JobFilterBar` before the page knows who is signed in: brand row (phones), headline,
 * subtitle, the aside pills, the hero search and the filter pills. */
function HomeHeroSkeleton() {
  return (
    <section aria-hidden className="hero-wash hairline-b">
      <div className="flex w-full flex-col px-4 pt-4 pb-4 sm:px-6 md:pt-5">
        <div className="mb-3.5 flex items-center justify-between md:hidden">
          <BrandMark name={BRAND_NAME} />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-[5.25rem] rounded-full" />
            <Skeleton className="h-8 w-[4.5rem] rounded-control-sm" />
          </div>
        </div>
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <SkeletonText
                text="font-display text-title1 md:text-[2rem] md:leading-tight"
                className="w-[19rem] max-w-full sm:w-96"
              />
              <SkeletonText text="mt-1 hidden text-callout sm:flex" className="w-[36rem] max-w-full" />
            </div>
            {/* Sources pill (`SourcesSummary`), sign-in button (lg) and the fold toggle (md+). */}
            <div className="flex shrink-0 items-center gap-2">
              <SourcesPillSkeleton />
              <Skeleton className="hidden h-8 w-[17.5rem] rounded-full lg:block" />
              <Skeleton className="hidden size-9 rounded-full md:block" />
            </div>
          </div>
          {/* Phones: search + "Filters" pill on one row (`MobileFilterBar`). */}
          <div className="flex items-center gap-2 md:hidden">
            <Skeleton className="h-12 min-w-0 flex-1 rounded-full" />
            <Skeleton className="h-12 w-24 rounded-full" />
          </div>
          {/* md+: search on its own line, the filter pills under it (`DesktopFilterBar`). */}
          <div className="hidden flex-col gap-2.5 md:flex">
            <Skeleton className="h-12 w-full rounded-full md:max-w-2xl" />
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              {["w-[7.25rem]", "w-[7.75rem]", "w-[7.25rem]", "w-24", "w-56", "w-[5.5rem]", "w-[4.5rem]", "w-[7.5rem]"].map((w, i) => (
                <Skeleton key={i} className={`h-9 rounded-full ${w}`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** `/` while the session check is pending (and the static HTML before the app hydrates): hero +
 * job browser, the same blocks `PublicJobs` / `Feed` render once loaded. */
export function HomeSkeleton() {
  const { t } = useTranslation("home");
  return (
    <>
      <HomeHeroSkeleton />
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-4 sm:px-6">
        <JobBrowserSkeleton label={t("list.loadingJobs")} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Job page */

/** `/jobs/view` body while the job loads: the same bordered frame and `JobDetail` page layout. */
export function JobViewSkeleton() {
  const { t } = useTranslation("job");
  return (
    <div
      aria-busy="true"
      aria-label={t("loadingAria")}
      className="rounded-[22px] border border-separator bg-background p-5 shadow-raised sm:p-7"
    >
      <JobDetailSkeleton variant="page" />
    </div>
  );
}

/** Suspense fallback of `/jobs/view`: nav bar (back link + title) and the job frame. */
export function JobViewPageSkeleton() {
  return (
    <>
      <NavBar
        title="Job details"
        largeTitle={false}
        leading={<SkeletonText text="px-1 text-body" className="w-16" />}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:pb-10">
        <JobViewSkeleton />
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ Live search */

/** Live search results: `JobCard`s with a Save action row. */
export function LiveSearchResultsSkeleton() {
  const { t } = useTranslation("search");
  return (
    <div aria-busy="true" aria-label={t("loadingAria")} className="flex flex-col gap-3">
      <JobCardSkeleton actions />
      <JobCardSkeleton actions />
      <JobCardSkeleton actions />
    </div>
  );
}

/** Suspense fallback of `/search`: nav bar with the search field, source chips and counts line. */
export function LiveSearchPageSkeleton() {
  return (
    <>
      <NavBar title="Search">
        <Skeleton className="h-11 w-full rounded-control lg:h-9" />
        <div className="flex flex-wrap gap-2">
          {["w-16", "w-24", "w-24", "w-36", "w-14"].map((w, i) => (
            <Skeleton key={i} className={`h-8 rounded-full ${w}`} />
          ))}
        </div>
        <SkeletonText text="text-footnote" className="w-72 max-w-full" />
      </NavBar>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 sm:px-6">
        <LiveSearchResultsSkeleton />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Tracker */

const TRACKER_COLUMNS = 5;

/** One `ApplicationCard`: title / company + delete button, source badge, status, note, next action. */
function ApplicationCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2 rounded-card bg-grouped-secondary p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SkeletonText text="text-subheadline" className="w-3/4" />
          <SkeletonText text="text-footnote" className="w-1/2" />
        </div>
        <Skeleton className="size-8 shrink-0 rounded-control-sm" />
      </div>
      <Skeleton className="h-6 w-24 rounded-full" />
      <div className="flex flex-col gap-1">
        <SkeletonText text="text-footnote" className="w-12" />
        <Skeleton className="h-9 w-full rounded-control" />
      </div>
      <div className="flex flex-col gap-1">
        <SkeletonText text="text-footnote" className="w-10" />
        {/* textarea rows=2: two subheadline lines + py-1 + border */}
        <span className="block text-subheadline">
          <Skeleton className="h-[calc(2lh+10px)] w-full rounded-control" />
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <SkeletonText text="text-footnote" className="w-20" />
        <Skeleton className="h-9 w-full rounded-control" />
      </div>
    </div>
  );
}

/** Tracker board while applications load: the five status columns (header + count) of the board
 * view, with a card in the first one. */
export function TrackerSkeleton() {
  const { t } = useTranslation("tracker");
  return (
    <div
      aria-busy="true"
      aria-label={t("loadingAria")}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      {Array.from({ length: TRACKER_COLUMNS }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SkeletonText text="text-subheadline" className="w-20" />
            <Skeleton className="h-6 w-7 rounded-full" />
          </div>
          {i < 2 ? <ApplicationCardSkeleton /> : null}
        </div>
      ))}
    </div>
  );
}

/** Tracker before the session check finishes: nav bar (title + Board / List switch) and the board. */
export function TrackerPageSkeleton() {
  const { t } = useTranslation("tracker");
  return (
    <>
      <NavBar title={t("nav.title")}>
        <Skeleton className="h-8 w-40 rounded-control" />
      </NavBar>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 sm:px-6">
        <TrackerSkeleton />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Connections */

/** A connection `Card`: heading + badge, two lines of copy, an action button. */
function ConnectionCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <SkeletonText text="text-headline" className="w-32" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div>
        <SkeletonText text="text-body" className="w-full" />
        <SkeletonText text="text-body" className="w-2/3" />
      </div>
      <Skeleton className="h-8 w-36 rounded-control-sm" />
    </div>
  );
}

/** Connections while platforms load: the "built-in sources" grouped list (header, rows, footer)
 * and the connection cards under it. */
export function ConnectionsSkeleton() {
  const { t } = useTranslation("connections");
  return (
    <div aria-busy="true" aria-label={t("loadingAria")} className="flex flex-col gap-4">
      <div aria-hidden className="flex flex-col gap-1.5">
        <SkeletonText text="px-4 text-footnote" className="w-40" />
        <ul className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
          {["w-28", "w-36", "w-24", "w-32", "w-20"].map((w, i) => (
            <li
              key={i}
              className="relative flex min-h-11 items-center gap-3 px-4 py-2 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:content-[''] not-first:before:hairline-t"
            >
              <span className="flex-1 py-0.5">
                <SkeletonText text="text-body" className={w} />
              </span>
              <SkeletonText text="text-body" className="w-20" />
            </li>
          ))}
        </ul>
        <SkeletonText text="px-4 text-footnote" className="w-3/4" />
      </div>
      <ConnectionCardSkeleton />
      <ConnectionCardSkeleton />
    </div>
  );
}

/** Suspense fallback of `/connections`. */
export function ConnectionsPageSkeleton() {
  const { t } = useTranslation("connections");
  return (
    <>
      <NavBar title={t("nav.title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-16 sm:px-6">
        <ConnectionsSkeleton />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Sign in */

/** Suspense fallback of `/login`: back link, brand, title + subtitle, the email card and the
 * privacy note — the "email" step of `LoginForm`. */
export function LoginSkeleton() {
  const { t } = useTranslation("auth");
  return (
    <main
      aria-busy="true"
      aria-label={t("loadingAria")}
      className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-8 px-4 py-12"
    >
      <div aria-hidden className="flex flex-col items-center gap-6">
        <SkeletonText text="self-start px-1 py-1 box-content text-subheadline" className="w-28" />
        <BrandMark name={BRAND_NAME} />
        <div className="flex w-full flex-col items-center gap-2">
          <SkeletonText text="font-display text-large-title" className="w-64" />
          <div className="flex w-full flex-col items-center">
            <SkeletonText text="text-body" className="w-80 max-w-full" />
            <SkeletonText text="text-body" className="w-48" />
          </div>
        </div>
        <div className="flex w-full flex-col gap-4 rounded-card bg-grouped-secondary p-5 shadow-card sm:p-6">
          <div className="flex flex-col gap-1.5">
            <SkeletonText text="text-subheadline" className="w-12" />
            <Skeleton className="h-11 w-full rounded-control lg:h-10" />
          </div>
          <Skeleton className="h-[50px] w-full rounded-card" />
        </div>
        <div className="flex w-full max-w-xs flex-col items-center">
          <SkeletonText text="text-footnote" className="w-full" />
          <SkeletonText text="text-footnote" className="w-2/3" />
        </div>
      </div>
    </main>
  );
}
