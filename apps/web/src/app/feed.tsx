"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { FeedPage, Job } from "@ujc/core";
import { SOURCE_IDS, sourceMeta } from "@ujc/core";
import {
  buttonClasses,
  Chip,
  EmptyState,
  JobCard,
  JobCardSkeleton,
  NavBar,
  RefreshIcon,
  SearchField,
  Spinner,
} from "@ujc/ui";
import { getFeed } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useInfiniteList } from "@/lib/use-infinite";
import { AccountMenu } from "@/app/nav";

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
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [feedKeywords, setFeedKeywords] = useState<string[]>(me?.preferences.keywords ?? []);

  // Debounced filter, per SCREENS.md §4 ("SearchField (q, debounced 300 ms)").
  useEffect(() => {
    const timer = setTimeout(() => setQ(draftQ), 300);
    return () => clearTimeout(timer);
  }, [draftQ]);

  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      getFeed({ cursor, q: q || undefined, source: source || undefined }),
    [q, source],
  );
  const onPage = useCallback((page: FeedPage) => setFeedKeywords(page.keywords), []);

  const { items, nextCursor, loading, error, initialized, loadMore, retry } = useInfiniteList<
    Job,
    FeedPage
  >(fetchPage, [q, source], onPage);

  const title = me ? `${greeting()}, ${firstName(me.user.email)}` : "Feed";

  return (
    <>
      <NavBar title={title} trailing={<div className="md:hidden"><AccountMenu /></div>}>
        <div className="flex flex-wrap items-center gap-1.5">
          {feedKeywords.length > 0 ? (
            <p className="text-subheadline text-label-secondary">
              {feedKeywords.slice(0, 3).join(", ")}
              {feedKeywords.length > 3 ? `, +${feedKeywords.length - 3}` : ""}
            </p>
          ) : (
            <p className="text-subheadline text-label-secondary">No keywords yet — add some to personalise your feed.</p>
          )}
          <Link href="/cv/" aria-label="Edit keywords" className="rounded-control-sm text-subheadline font-medium text-tint hover:underline focus-ring">
            Edit
          </Link>
        </div>
        <SearchField value={draftQ} onChange={setDraftQ} label="Filter your feed" placeholder="Filter your feed" />
        <div role="group" aria-label="Filter by source" className="flex flex-wrap gap-2">
          <Chip selected={source === ""} onClick={() => setSource("")}>
            All sources
          </Chip>
          {SOURCE_IDS.map((id) => (
            <Chip key={id} selected={source === id} onClick={() => setSource(id)}>
              {sourceMeta(id).label}
            </Chip>
          ))}
        </div>
      </NavBar>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 sm:px-6">
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
          <div className="flex flex-col gap-3">
            {items.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                detailsHref={`/jobs/view?id=${encodeURIComponent(job.id)}`}
                linkAs={Link}
              />
            ))}
          </div>
        )}

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
