"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { FeedPage, Job } from "@ujc/core";
import { SOURCE_IDS } from "@ujc/core";
import {
  buttonClasses,
  EmptyState,
  JobCardSkeleton,
  NavBar,
  RefreshIcon,
  Spinner,
  Toggle,
  useToast,
} from "@ujc/ui";
import { ApiError, getFeed, refreshMatches } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useInfiniteList } from "@/lib/use-infinite";
import { useScrollRestoration, useViewState } from "@/lib/view-cache";
import { AccountMenu } from "@/app/nav";
import { SaveJobButton } from "@/app/save-job-button";
import { JobBrowser } from "@/app/job-browser";
import { JobFilterBar, useJobFilters } from "@/app/job-filters";
import { highlightTerms } from "@/lib/highlight";

/** "linh@example.com" -> "Linh" (we only have an email, not a display name yet). */
function firstName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const word = local.split(/[._+-]/)[0] ?? local;
  return word ? word[0].toUpperCase() + word.slice(1) : email;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function FeedInner() {
  const { me } = useSession();
  const toast = useToast();
  const filters = useJobFilters("feed");
  const [bestMatches, setBestMatches] = useViewState("feed:best", false);
  const [feedKeywords, setFeedKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [refreshing, setRefreshing] = useState(false);

  const { params: filterParams } = filters;
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      getFeed({ cursor, ...filterParams, sort: bestMatches ? "score" : undefined }),
    // `filters.key` captures every value in `filterParams`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.key, bestMatches],
  );
  const onPage = useCallback((page: FeedPage) => setFeedKeywords(page.keywords), []);

  const listKey = `feed:${filters.key}:${bestMatches}`;
  const { items, nextCursor, loading, error, initialized, loadMore, retry, restored } = useInfiniteList<
    Job,
    FeedPage
  >(fetchPage, [filters.key, bestMatches], { onPage, cacheKey: listKey });
  useScrollRestoration(listKey, restored);

  async function handleRefreshScores() {
    setRefreshing(true);
    try {
      await refreshMatches();
      toast.show({
        tone: "success",
        title: "Refreshing your scores",
        message: "We're rescoring your feed against your CV — check back in a minute.",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast.show({ tone: "error", title: "Daily limit reached", message: err.message });
      } else {
        toast.show({
          tone: "error",
          title: "Couldn't refresh scores",
          message: err instanceof ApiError ? err.message : "Please try again.",
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  const title = me ? `${greeting()}, ${firstName(me.user.email)}` : "Feed";

  return (
    <>
      <NavBar wide largeTitle={false} title={title} trailing={<div className="md:hidden"><AccountMenu /></div>}>
        <JobFilterBar
          filters={filters}
          sources={SOURCE_IDS}
          extra={
            <>
              <label className="flex items-center gap-1.5 text-subheadline text-label-secondary">
                <Toggle label="Best matches" checked={bestMatches} onChange={setBestMatches} />
                Best matches
              </label>
              <button
                type="button"
                onClick={() => void handleRefreshScores()}
                disabled={refreshing}
                className={buttonClasses({ variant: "gray", size: "sm", className: "disabled:opacity-40" })}
              >
                {refreshing ? <Spinner size={14} /> : <RefreshIcon size={16} />}
                Refresh scores
              </button>
            </>
          }
        />
        <p className="flex flex-wrap items-center gap-1.5 text-footnote text-label-secondary">
          {feedKeywords.length > 0 ? (
            <span>
              Your keywords: {feedKeywords.slice(0, 5).join(", ")}
              {feedKeywords.length > 5 ? `, +${feedKeywords.length - 5}` : ""}
            </span>
          ) : (
            <span>No keywords yet — add some to personalise your feed.</span>
          )}
          <Link href="/cv/" aria-label="Edit keywords" className="rounded-control-sm font-medium text-tint hover:underline focus-ring">
            Edit
          </Link>
        </p>
      </NavBar>

      <div className="flex w-full flex-col gap-4 px-4 pb-4 sm:px-6">
        {loading && items.length === 0 ? (
          <div aria-busy="true" aria-label="Loading your feed" className="flex flex-col gap-3">
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
            title="No matches yet — let's widen the net"
            message="Try fewer keywords, or turn off Remote only."
            action={
              <Link href="/cv/" className={buttonClasses({ size: "sm" })}>
                Edit keywords
              </Link>
            }
            secondaryAction={
              <Link href="/search/" className={buttonClasses({ variant: "plain", size: "sm" })}>
                Search live instead
              </Link>
            }
          />
        ) : (
          <JobBrowser
            jobs={filters.hiddenIds ? items.filter((j) => !filters.hiddenIds?.has(j.id)) : items}
            stateKey="feed"
            highlight={highlightTerms({ q: filters.q, tech: filters.tech, keywords: feedKeywords })}
            signedIn={true}
            renderActions={(job) => <SaveJobButton jobId={job.id} />}
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
                    You&apos;ve reached the end of your feed. New jobs arrive every morning.
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

export function Feed() {
  return (
    <RequireAuth>
      <FeedInner />
    </RequireAuth>
  );
}
