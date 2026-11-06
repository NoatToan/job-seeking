"use client";

import { useCallback } from "react";
import Link from "next/link";
import type { Job, PublicJobsPage, SourceInfo } from "@ujc/core";
import { sourceMeta } from "@ujc/core";
import {
  Badge,
  buttonClasses,
  EmptyState,
  JobCardSkeleton,
  NavBar,
  RefreshIcon,
  Spinner,
} from "@ujc/ui";
import { getPublicJobs, getSources } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { useApi } from "@/lib/use-api";
import { useInfiniteList } from "@/lib/use-infinite";
import { useScrollRestoration } from "@/lib/view-cache";
import { AccountMenu } from "@/app/nav";
import { JobBrowser } from "@/app/job-browser";
import { JobFilterBar, useJobFilters } from "@/app/job-filters";
import { highlightTerms } from "@/lib/highlight";

function statusTone(status: SourceInfo["status"]): "success" | "warning" | "danger" {
  if (status === "error") return "danger";
  if (status === "running") return "warning";
  return "success";
}

/** One-line strip of every source and its latest crawl status, so a visitor can see at a glance
 * where the jobs below are coming from and whether any source is currently down. */
function SourceStatusStrip({ sources }: { sources: SourceInfo[] }) {
  if (sources.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Source status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary"
    >
      {sources.map((s) => (
        <span key={s.source} className="inline-flex items-center gap-1">
          {sourceMeta(s.source).label}
          <Badge tone={statusTone(s.status)} className="h-4 px-1.5 text-micro">
            {s.status}
          </Badge>
        </span>
      ))}
    </div>
  );
}

/**
 * `/` for a signed-out visitor: the public job catalogue (Slack request — "without logging in,
 * the home page should still show all the jobs we have"). Unlike `Feed`, this calls only public
 * endpoints (`GET /api/jobs`, `GET /api/sources`), so it never trips the global 401 handler and
 * never redirects to `/login` (see `lib/session.tsx` `isPublicRoute`).
 */
export function PublicJobs() {
  const filters = useJobFilters("public");
  const { data: sources } = useApi(getSources, [], { cacheKey: "sources" });

  const { params: filterParams } = filters;
  const fetchPage = useCallback(
    (cursor: string | undefined) => getPublicJobs({ cursor, ...filterParams }),
    // `filters.key` captures every value in `filterParams`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.key],
  );

  const listKey = `public:${filters.key}`;
  const { items, nextCursor, loading, error, initialized, loadMore, retry, restored } = useInfiniteList<
    Job,
    PublicJobsPage
  >(fetchPage, [filters.key], { cacheKey: listKey });
  useScrollRestoration(listKey, restored);

  return (
    <>
      <NavBar
        wide
        largeTitle={false}
        title="Every job, from every source, in one place"
        trailing={
          <>
            <Link href="/login/" className={buttonClasses({ size: "sm", className: "hidden md:inline-flex" })}>
              Sign in to get matches from your CV
            </Link>
            <div className="md:hidden">
              <AccountMenu />
            </div>
          </>
        }
      >
        <JobFilterBar filters={filters} sources={(sources ?? []).map((s) => s.source)} />
        <SourceStatusStrip sources={sources ?? []} />
      </NavBar>

      <div className="flex w-full flex-col gap-4 px-4 pb-4 sm:px-6">
        {loading && items.length === 0 ? (
          <div aria-busy="true" aria-label="Loading jobs" className="flex flex-col gap-3">
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title="We couldn't load jobs"
            message="It's on our side, not yours. Check your connection and try again."
            action={
              <button type="button" onClick={retry} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                Try again
              </button>
            }
          />
        ) : initialized && items.length === 0 ? (
          <EmptyState
            illustration="search"
            title="No jobs match yet"
            message="Try a different search, or clear the filters."
            action={
              filters.activeCount ? (
                <button
                  type="button"
                  onClick={filters.clear}
                  className={buttonClasses({ variant: "gray", size: "sm" })}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <JobBrowser
            jobs={filters.hiddenIds ? items.filter((j) => !filters.hiddenIds?.has(j.id)) : items}
            stateKey="public"
            highlight={highlightTerms({ q: filters.q, tech: filters.tech })}
            signedIn={false}
            footer={
              <>
                {nextCursor ? <LoadMoreSentinel active={!loading} onVisible={loadMore} /> : null}
                {loading && items.length > 0 ? (
                  <p className="flex items-center justify-center gap-2 py-2 text-footnote text-label-secondary">
                    <Spinner size={14} /> Loading more…
                  </p>
                ) : null}
                {initialized && !nextCursor && items.length > 0 ? (
                  <p role="status" className="py-4 text-center text-footnote text-label-secondary">
                    You&apos;ve reached the end — new jobs are crawled every day.
                  </p>
                ) : null}
              </>
            }
          />
        )}
      </div>
    </>
  );
}
