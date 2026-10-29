"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type { FeedPage, Job } from "@ujc/core";
import { SOURCE_IDS, sourceMeta } from "@ujc/core";
import { JobCard } from "@ujc/ui";
import { getFeed } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useInfiniteList } from "@/lib/use-infinite";

function FeedSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading your feed">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

function FeedInner() {
  const { me } = useSession();
  const [draftQ, setDraftQ] = useState("");
  const [draftSource, setDraftSource] = useState("");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [feedKeywords, setFeedKeywords] = useState<string[]>(me?.preferences.keywords ?? []);

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setQ(draftQ);
    setSource(draftSource);
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Your feed</h1>
          <Link href="/cv/" className="text-sm underline underline-offset-2">
            Edit keywords
          </Link>
        </div>
        {feedKeywords.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {feedKeywords.map((k) => (
              <li
                key={k}
                className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium dark:bg-zinc-800"
              >
                {k}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            No keywords yet —{" "}
            <Link href="/cv/" className="underline underline-offset-2">
              add some
            </Link>{" "}
            to personalise your feed.
          </p>
        )}
      </header>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="feed-q" className="sr-only">
          Search within your feed
        </label>
        <input
          id="feed-q"
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          placeholder="Narrow down by title, company or skill"
          className="min-w-56 flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <label htmlFor="feed-source" className="sr-only">
          Source
        </label>
        <select
          id="feed-source"
          value={draftSource}
          onChange={(e) => setDraftSource(e.target.value)}
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All sources</option>
          {SOURCE_IDS.map((id) => (
            <option key={id} value={id}>
              {sourceMeta(id).label}
            </option>
          ))}
        </select>
        <button className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Apply
        </button>
      </form>

      {loading && items.length === 0 ? (
        <FeedSkeleton />
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <p>Could not load your feed: {error.message}</p>
          <button type="button" onClick={retry} className="mt-2 underline">
            Try again
          </button>
        </div>
      ) : initialized && items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No matches yet — add keywords or try{" "}
          <Link href="/search/" className="underline underline-offset-2">
            Live search
          </Link>
          .
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((job) => (
            <div key={job.id} className="flex flex-col gap-1">
              <JobCard job={job} />
              <Link
                href={`/jobs/view?id=${encodeURIComponent(job.id)}`}
                className="self-start text-xs text-zinc-500 underline"
              >
                View details →
              </Link>
            </div>
          ))}
        </div>
      )}

      {nextCursor ? <LoadMoreSentinel active={!loading} onVisible={loadMore} /> : null}
      {initialized && !nextCursor && items.length > 0 ? (
        <p className="text-center text-sm text-zinc-500">You&apos;ve reached the end of your feed.</p>
      ) : null}
    </main>
  );
}

export function Feed() {
  return (
    <RequireAuth>
      <FeedInner />
    </RequireAuth>
  );
}
