import { Suspense } from "react";
import Link from "next/link";
import { DEEP_LINK_SITES, SOURCE_IDS, isSourceId, sourceMeta } from "@ujc/core";
import { JobCard, SourceBadge } from "@ujc/ui";
import { listJobs, PAGE_SIZE, sourceStatuses, type JobFilters } from "@/lib/jobs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseFilters(sp: Awaited<SearchParams>): JobFilters {
  const source = one(sp.source);
  return {
    q: one(sp.q)?.slice(0, 100),
    source: source && isSourceId(source) ? source : undefined,
    remote: one(sp.remote) === "1",
    page: Number(one(sp.page)) || 1,
  };
}

function hrefFor(f: JobFilters, page: number): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.source) p.set("source", f.source);
  if (f.remote) p.set("remote", "1");
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/?${s}` : "/";
}

async function SourceStrip() {
  const statuses = await sourceStatuses().catch(() => []);
  if (statuses.length === 0) {
    return <p className="text-sm text-zinc-500">No crawl has run yet.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
      {statuses.map((s) => (
        <li key={s.source} className="flex items-center gap-1.5">
          <SourceBadge source={s.source} />
          <span>
            {s.total} jobs · last crawl {new Date(s.startedAt).toLocaleString("en-AU", { timeZone: "Asia/Ho_Chi_Minh" })}
            {s.status === "error" ? " · ⚠ error" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

async function JobList({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);
  const { jobs, total } = await listJobs(filters);
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const q = filters.q || "software engineer";

  return (
    <>
      <form className="flex flex-wrap items-center gap-2" action="/">
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Title, company or skill"
          className="min-w-56 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          name="source"
          defaultValue={filters.source ?? ""}
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
          <input type="checkbox" name="remote" value="1" defaultChecked={filters.remote} /> Remote only
        </label>
        <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Search
        </button>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {total.toLocaleString()} jobs · also search on{" "}
        {DEEP_LINK_SITES.map((site, i) => (
          <span key={site.label}>
            {i > 0 ? ", " : ""}
            <a href={site.search(q)} target="_blank" rel="noopener noreferrer" className="underline">
              {site.label}
            </a>
          </span>
        ))}
      </p>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No jobs match. Try another keyword, or wait for the next daily crawl.
        </p>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={hrefFor(filters, page - 1)}>← Previous</Link> : <span />}
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={hrefFor(filters, page + 1)}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Unified Job Crawler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Jobs crawled daily from open feeds and public company job boards. Every job shows where it came from and
          links to the original posting.
        </p>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading sources…</p>}>
          <SourceStrip />
        </Suspense>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading jobs…</p>}>
        <JobList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
