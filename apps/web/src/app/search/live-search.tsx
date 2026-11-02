"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job, LiveSearchPage as LiveSearchPageType } from "@ujc/core";
import {
  Badge,
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
import { liveSearch } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useInfiniteList } from "@/lib/use-infinite";
import { AccountMenu } from "@/app/nav";

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

  // Commit the draft 500ms after the user stops typing (Enter commits immediately below).
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draftQuery), 500);
    return () => clearTimeout(timer);
  }, [draftQuery]);

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

  function commitQuery() {
    setSourceAgg({});
    setQuery(draftQuery);
  }

  const sourceErrors = LIVE_SOURCES.filter((s) => sourceAgg[s.id]?.error);

  return (
    <>
      <NavBar title="Search" trailing={<div className="md:hidden"><AccountMenu /></div>}>
        <SearchField
          value={draftQuery}
          onChange={setDraftQuery}
          label="Search query"
          placeholder="Job title, skill or company"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitQuery();
            }
          }}
        />
        <div role="group" aria-label="Sources" className="flex flex-wrap gap-2">
          {LIVE_SOURCES.map((s) => (
            <Chip key={s.id} selected={enabledSources.has(s.id)} onClick={() => toggleSource(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-footnote text-label-secondary">
          {LIVE_SOURCES.filter((s) => enabledSources.has(s.id)).map((s) => {
            const agg = sourceAgg[s.id];
            const stillLoading = loading && !agg;
            return (
              <span key={s.id} className="inline-flex items-center gap-1">
                {s.label}
                {stillLoading ? (
                  <Spinner size={12} />
                ) : agg?.error ? (
                  <Badge tone="warning">didn&apos;t answer</Badge>
                ) : agg ? (
                  <span className="tabular-nums">{agg.count}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      </NavBar>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 sm:px-6">
        {sourceErrors.length > 0 ? (
          <div className="flex flex-col gap-1">
            {sourceErrors.map((s) => (
              <p key={s.id} className="text-footnote text-warning-ink">
                {s.label}: {sourceAgg[s.id]?.error}
              </p>
            ))}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div aria-busy="true" aria-label="Searching" className="flex flex-col gap-3">
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title="Could not search right now"
            message={error.message}
            action={
              <button type="button" onClick={retry} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                Try again
              </button>
            }
          />
        ) : initialized && items.length === 0 && query ? (
          <EmptyState
            illustration="search"
            title={`Nothing on these sources for "${query}" right now`}
            message="Try a broader title, or turn on more sources."
          />
        ) : initialized && items.length === 0 ? (
          <EmptyState
            illustration="search"
            title="Search every platform at once"
            message="Results come straight from Seek, Himalayas, Remotive, We Work Remotely and Arc."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((job) => (
              <JobCard key={`${job.source}-${job.id}`} job={job} />
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
            You&apos;ve reached the end of these results.
          </p>
        ) : null}
        <p className="text-center text-footnote text-label-secondary">
          Upwork isn&apos;t searched here (its terms don&apos;t allow it) —{" "}
          <a
            href={`https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-tint hover:underline focus-ring rounded-control-sm"
          >
            search on Upwork
          </a>
          .
        </p>
      </div>
    </>
  );
}

export function LiveSearch() {
  return (
    <RequireAuth>
      <LiveSearchInner />
    </RequireAuth>
  );
}
