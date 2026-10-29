"use client";

import { useCallback, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Job, LiveSearchPage as LiveSearchPageType } from "@ujc/core";
import { JobCard } from "@ujc/ui";
import { liveSearch } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useInfiniteList } from "@/lib/use-infinite";

// Live-search source ids, per docs/product/FLOW_V2.md §4 (`sources=seek,himalayas,remotive,wwr,arc`).
// Distinct from packages/core's SOURCES catalogue (which covers the daily-crawl feed sources).
const LIVE_SOURCES = [
  { id: "seek", label: "Seek" },
  { id: "himalayas", label: "Himalayas" },
  { id: "remotive", label: "Remotive" },
  { id: "wwr", label: "We Work Remotely" },
  { id: "arc", label: "Arc" },
] as const;

type LiveSourceId = (typeof LIVE_SOURCES)[number]["id"];

interface SourceAgg {
  count: number;
  error?: string;
}

function SearchSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Searching">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

function LiveSearchInner() {
  const { me } = useSession();
  const firstKeyword = me?.preferences.keywords[0] ?? "";
  const [draftQuery, setDraftQuery] = useState(firstKeyword);
  const [query, setQuery] = useState(firstKeyword);
  const [enabledSources, setEnabledSources] = useState<Set<LiveSourceId>>(
    () => new Set(LIVE_SOURCES.map((s) => s.id)),
  );
  const [sourceAgg, setSourceAgg] = useState<Partial<Record<LiveSourceId, SourceAgg>>>({});

  const sourceIds = useMemo(
    () => LIVE_SOURCES.filter((s) => enabledSources.has(s.id)).map((s) => s.id),
    [enabledSources],
  );
  const sourcesKey = sourceIds.join(",");

  const fetchPage = useCallback(
    (cursor: string | undefined) => liveSearch({ q: query, sources: sourceIds, cursor }),
    // `sourcesKey` deliberately replaces `sourceIds` in deps below: same ids, stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, sourcesKey],
  );

  const onPage = useCallback((page: LiveSearchPageType) => {
    setSourceAgg((prev) => {
      const next = { ...prev };
      for (const s of page.sources) {
        const id = s.id as LiveSourceId;
        const existing = next[id];
        next[id] = { count: (existing?.count ?? 0) + s.count, error: s.error };
      }
      return next;
    });
  }, []);

  const { items, nextCursor, loading, error, initialized, loadMore, retry } = useInfiniteList<
    Job,
    LiveSearchPageType
  >(fetchPage, [query, sourcesKey], onPage);

  function toggleSource(id: LiveSourceId) {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSourceAgg({});
    setQuery(draftQuery);
  }

  const sourceErrors = LIVE_SOURCES.filter((s) => sourceAgg[s.id]?.error);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Live search</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Searches job platforms right now, across the sources you pick below.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="live-search-q" className="sr-only">
          Search query
        </label>
        <input
          id="live-search-q"
          value={draftQuery}
          onChange={(e) => setDraftQuery(e.target.value)}
          placeholder="Title, company or skill"
          className="min-w-56 flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Search
        </button>
      </form>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Sources</legend>
        {LIVE_SOURCES.map((s) => {
          const on = enabledSources.has(s.id);
          const agg = sourceAgg[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSource(s.id)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                on
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-500 dark:border-zinc-700"
              }`}
            >
              {s.label}
              {agg ? ` · ${agg.count}` : ""}
              {agg?.error ? " ⚠" : ""}
            </button>
          );
        })}
      </fieldset>

      {sourceErrors.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
          {sourceErrors.map((s) => (
            <li key={s.id}>
              {s.label}: {sourceAgg[s.id]?.error}
            </li>
          ))}
        </ul>
      ) : null}

      {loading && items.length === 0 ? (
        <SearchSkeleton />
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <p>Could not search right now: {error.message}</p>
          <button type="button" onClick={retry} className="mt-2 underline">
            Try again
          </button>
        </div>
      ) : initialized && items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No results yet. Try a different query or turn on more sources.
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((job) => (
            <JobCard key={`${job.source}-${job.id}`} job={job} />
          ))}
        </div>
      )}

      {nextCursor ? <LoadMoreSentinel active={!loading} onVisible={loadMore} /> : null}
      {initialized && !nextCursor && items.length > 0 ? (
        <p className="text-center text-sm text-zinc-500">You&apos;ve reached the end of these results.</p>
      ) : null}
    </main>
  );
}

export function LiveSearch() {
  return (
    <RequireAuth>
      <LiveSearchInner />
    </RequireAuth>
  );
}
