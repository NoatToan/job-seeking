"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import type { Job, PublicJobsPage, SourceInfo } from "@ujc/core";
import { sourceMeta } from "@ujc/core";
import {
  Badge,
  buttonClasses,
  Chip,
  EmptyState,
  JobCardSkeleton,
  NavBar,
  RefreshIcon,
  SearchField,
  Spinner,
  Toggle,
} from "@ujc/ui";
import { getPublicJobs, getSources } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { useApi } from "@/lib/use-api";
import { useInfiniteList } from "@/lib/use-infinite";
import { useScrollRestoration, useViewState } from "@/lib/view-cache";
import { AccountMenu } from "@/app/nav";
import { JobBrowser } from "@/app/job-browser";
import { TimezonePicker } from "@/app/work-hours";

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
  // Filters live in the view cache, so Back from a job restores the same filtered list.
  const [draftQ, setDraftQ] = useViewState("public:draftQ", "");
  const [q, setQ] = useViewState("public:q", "");
  const [source, setSource] = useViewState("public:source", "");
  const [remoteOnly, setRemoteOnly] = useViewState("public:remote", false);

  // Debounced filter, same 300 ms as the signed-in feed (SCREENS.md §4).
  useEffect(() => {
    const timer = setTimeout(() => setQ(draftQ), 300);
    return () => clearTimeout(timer);
  }, [draftQ, setQ]);

  const { data: sources } = useApi(getSources, [], { cacheKey: "sources" });

  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      getPublicJobs({
        cursor,
        q: q || undefined,
        source: source || undefined,
        remote: remoteOnly || undefined,
      }),
    [q, source, remoteOnly],
  );

  const listKey = `public:${JSON.stringify([q, source, remoteOnly])}`;
  const { items, nextCursor, loading, error, initialized, loadMore, retry, restored } = useInfiniteList<
    Job,
    PublicJobsPage
  >(fetchPage, [q, source, remoteOnly], { cacheKey: listKey });
  useScrollRestoration(listKey, restored);

  return (
    <>
      <NavBar
        wide
        title="Every job, from every source, in one place"
        trailing={<div className="md:hidden"><AccountMenu /></div>}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-subheadline text-label-secondary">
            Sign in to see matches picked for your CV, and to track applications.
          </p>
          <Link href="/login/" className={buttonClasses({ size: "sm" })}>
            Sign in to get matches from your CV
          </Link>
        </div>
        <SearchField
          value={draftQ}
          onChange={setDraftQ}
          label="Search jobs"
          placeholder="Job title, company or skill"
        />
        <div role="group" aria-label="Filter by source" className="flex flex-wrap gap-2">
          <Chip selected={source === ""} onClick={() => setSource("")}>
            All sources
          </Chip>
          {(sources ?? []).map((s) => (
            <Chip key={s.source} selected={source === s.source} onClick={() => setSource(s.source)}>
              {sourceMeta(s.source).label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-subheadline text-label-secondary">
            <Toggle label="Remote only" checked={remoteOnly} onChange={setRemoteOnly} />
            Remote only
          </label>
          <TimezonePicker />
        </div>
        <SourceStatusStrip sources={sources ?? []} />
      </NavBar>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-10 sm:px-6">
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
              source || q || remoteOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraftQ("");
                    setSource("");
                    setRemoteOnly(false);
                  }}
                  className={buttonClasses({ variant: "gray", size: "sm" })}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <JobBrowser
            jobs={items}
            stateKey="public"
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
