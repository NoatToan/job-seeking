"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Job, PublicJobsPage } from "@ujc/core";
import { buttonClasses, EmptyState, JobCardSkeleton, RefreshIcon, SparklesIcon, Spinner } from "@ujc/ui";
import { getPublicJobs, getSources } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { useApi } from "@/lib/use-api";
import { useInfiniteList } from "@/lib/use-infinite";
import { useScrollRestoration } from "@/lib/view-cache";
import { HomeHero, SourcesSummary } from "@/app/home-hero";
import { SaveJobButton } from "@/app/save-job-button";
import { useSession } from "@/lib/session";
import { firstName, greeting } from "@/app/feed";
import { JobBrowser } from "@/app/job-browser";
import { JobFilterBar, useJobFilters, useVisibleJobs } from "@/app/job-filters";
import { highlightTerms } from "@/lib/highlight";

/**
 * `/` for a signed-out visitor: the public job catalogue (Slack request — "without logging in,
 * the home page should still show all the jobs we have"). Unlike `Feed`, this calls only public
 * endpoints (`GET /api/jobs`, `GET /api/sources`), so it never trips the global 401 handler and
 * never redirects to `/login` (see `lib/session.tsx` `isPublicRoute`).
 */
export function PublicJobs({
  signedIn = false,
  modeSwitch,
}: {
  /** Signed in, "All jobs" mode: same catalogue, plus Track on each row and in the detail. */
  signedIn?: boolean;
  /** "All jobs | For you" switch (signed in only), shown in the hero. */
  modeSwitch?: ReactNode;
} = {}) {
  const { me } = useSession();
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
  const visible = useVisibleJobs(filters, items);

  return (
    <>
      <HomeHero
        title={
          me && signedIn ? (
            `${greeting()}, ${firstName(me.user.email)}`
          ) : (
            <>
              Find a tech job you&apos;ll{" "}
              <span className="bg-[linear-gradient(90deg,#ea580c,#e11d48_55%,#9333ea)] bg-clip-text text-transparent">love</span>
            </>
          )
        }
        compactOnPhones
        subtitle={
          me && signedIn ? (
            <p>
              Free search across every job we have — not filtered by your profile.{" "}
              {me.latestCv ? null : (
                <>
                  <Link href="/cv/" className="rounded-control-sm font-medium text-tint hover:underline focus-ring">
                    Upload your CV
                  </Link>{" "}
                  to get fit scores in <span className="font-medium">For you</span>.
                </>
              )}
            </p>
          ) : (
            "Remote and relocation roles from Himalayas, We Work Remotely, Seek, Arc and more — in one place, refreshed every morning."
          )
        }
        aside={
          <>
            {modeSwitch}
            <SourcesSummary sources={sources ?? []} />
            <span className={signedIn ? "hidden" : "hidden lg:inline-flex"}>
              <Link href="/login/" className={buttonClasses({ size: "sm", className: "rounded-full px-4" })}>
                <SparklesIcon size={16} />
                Sign in to get matches from your CV
              </Link>
            </span>
          </>
        }
      >
        <JobFilterBar filters={filters} sources={(sources ?? []).map((s) => s.source)} />
      </HomeHero>

      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-4 sm:px-6">
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
            jobs={visible}
            stateKey="public"
            highlight={highlightTerms({ q: filters.q, tech: filters.tech })}
            signedIn={signedIn}
            renderActions={signedIn ? (job) => <SaveJobButton jobId={job.id} /> : undefined}
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
