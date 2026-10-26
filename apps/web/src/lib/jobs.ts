import "server-only";
import { connection } from "next/server";
import type { Job, SourceStatus } from "@ujc/core";
import { db } from "./db";

export const PAGE_SIZE = 50;

export interface JobFilters {
  q?: string;
  source?: string;
  remote?: boolean;
  page?: number;
}

export async function listJobs(filters: JobFilters): Promise<{ jobs: Job[]; total: number }> {
  await connection();
  const sql = db();
  const page = Math.max(1, filters.page ?? 1);
  const q = filters.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  const where = sql`
    WHERE TRUE
    ${filters.source ? sql`AND source = ${filters.source}` : sql``}
    ${filters.remote ? sql`AND remote` : sql``}
    ${pattern ? sql`AND (title ILIKE ${pattern} OR company ILIKE ${pattern} OR array_to_string(tags, ' ') ILIKE ${pattern})` : sql``}
  `;

  const [rows, [{ count }]] = await Promise.all([
    sql`
      SELECT id, source, url, apply_url, title, company, location, remote, employment_type,
             salary_text, tags, posted_at, first_seen_at
      FROM jobs ${where}
      ORDER BY COALESCE(posted_at, first_seen_at) DESC, id DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
    `,
    sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs ${where}`,
  ]);

  return {
    total: count,
    jobs: rows.map((r) => ({
      id: String(r.id),
      source: r.source,
      url: r.url,
      applyUrl: r.apply_url,
      title: r.title,
      company: r.company,
      location: r.location,
      remote: r.remote,
      employmentType: r.employment_type,
      salaryText: r.salary_text,
      tags: r.tags ?? [],
      postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
      firstSeenAt: new Date(r.first_seen_at).toISOString(),
    })),
  };
}

/** Last crawl per source + how many jobs we hold from it. */
export async function sourceStatuses(): Promise<SourceStatus[]> {
  await connection();
  const rows = await db()`
    SELECT DISTINCT ON (r.source) r.source, r.status, r.started_at, r.finished_at, r.jobs_found, r.jobs_new,
           (SELECT count(*)::int FROM jobs j WHERE j.source = r.source) AS total
    FROM crawl_runs r
    ORDER BY r.source, r.started_at DESC
  `;
  return rows.map((r) => ({
    source: r.source,
    status: r.status,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    jobsFound: r.jobs_found,
    jobsNew: r.jobs_new,
    total: r.total,
  }));
}
