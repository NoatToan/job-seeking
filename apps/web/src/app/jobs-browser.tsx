"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DEEP_LINK_SITES, SOURCE_IDS, sourceMeta } from "@ujc/core";
import type { SourceInfo } from "@ujc/core";
import { JobCard, SourceBadge } from "@ujc/ui";
import { getJobs, getSources } from "@/lib/api";
import { useApi, type UseApiState } from "@/lib/use-api";

const input =
  "min-w-56 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function one(v: string | null): string | undefined {
  return v ?? undefined;
}

function JobsSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading jobs">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

function SourceStrip({ state }: { state: UseApiState<SourceInfo[]> }) {
  if (state.loading) return <p className="text-sm text-zinc-500">Loading sources…</p>;
  if (state.error) return null; // non-fatal: the jobs list still works without it
  if (!state.data || state.data.length === 0) {
    return <p className="text-sm text-zinc-500">No crawl has run yet.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
      {state.data.map((s) => (
        <li key={s.source} className="flex items-center gap-1.5">
          <SourceBadge source={s.source} />
          <span>
            {s.total} jobs · last crawl{" "}
            {new Date(s.startedAt).toLocaleString("en-AU", { timeZone: "Asia/Ho_Chi_Minh" })}
            {s.status === "error" ? " · ⚠ error" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function JobsBrowser() {
  const searchParams = useSearchParams();
  const q = one(searchParams.get("q"));
  const source = one(searchParams.get("source"));
  const remote = searchParams.get("remote") === "1";
  const page = Number(searchParams.get("page")) || 1;

  const jobsState = useApi(() => getJobs({ q, source, remote, page }), [q, source, remote, page]);
  const sourcesState = useApi(() => getSources(), []);

  const pages = useMemo(() => {
    if (!jobsState.data) return 1;
    return Math.max(1, Math.ceil(jobsState.data.total / jobsState.data.pageSize));
  }, [jobsState.data]);

  function hrefFor(nextPage: number): string {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (source) p.set("source", source);
    if (remote) p.set("remote", "1");
    if (nextPage > 1) p.set("page", String(nextPage));
    const s = p.toString();
    return s ? `/?${s}` : "/";
  }

  const keywordsForDeepLinks = q || "software engineer";

  return (
    <div className="flex flex-col gap-5">
      <form className="flex flex-wrap items-center gap-2" action="/" method="get">
        <input name="q" defaultValue={q} placeholder="Title, company or skill" className={input} />
        <select
          name="source"
          defaultValue={source ?? ""}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">All sources</option>
          {SOURCE_IDS.map((id) => (
            <option key={id} value={id}>
              {sourceMeta(id).label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="remote" value="1" defaultChecked={remote} /> Remote only
        </label>
        <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Search
        </button>
      </form>

      <SourceStrip state={sourcesState} />

      {jobsState.data ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {jobsState.data.total.toLocaleString()} jobs · also search on{" "}
          {DEEP_LINK_SITES.map((site, i) => (
            <span key={site.label}>
              {i > 0 ? ", " : ""}
              <a
                href={site.search(keywordsForDeepLinks)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {site.label}
              </a>
            </span>
          ))}
        </p>
      ) : null}

      {jobsState.loading ? (
        <JobsSkeleton />
      ) : jobsState.error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Could not load jobs: {jobsState.error.message}
        </p>
      ) : jobsState.data && jobsState.data.items.length > 0 ? (
        <div className="grid gap-3">
          {jobsState.data.items.map((job) => (
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
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No jobs match. Try another keyword, or wait for the next daily crawl.
        </p>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={hrefFor(page - 1)}>← Previous</Link> : <span />}
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={hrefFor(page + 1)}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
