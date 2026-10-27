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

export interface JobQuery extends JobFilters {
  /** extra: job location must contain one of these (case-insensitive) */
  locations?: string[];
  /** extra: restrict to these sources */
  sources?: string[];
  /** also include jobs a site's own search returned for this profile (profile_jobs) */
  profileId?: string;
  /** hide remote jobs whose open_to clearly excludes the candidate (unknown is kept) */
  acceptedOpenTo?: string[] | null;
}

const JOB_COLUMNS = `id, source, url, apply_url, title, company, location, remote, employment_type,
  salary_text, tags, open_to, posted_at, first_seen_at`;

/** Jobs matching the filters. With keywords, results are ranked by full-text relevance. */
export async function listJobs(filters: JobQuery): Promise<{ jobs: Job[]; total: number }> {
  await connection();
  const sql = db();
  const page = Math.max(1, filters.page ?? 1);
  const q = filters.q?.trim();
  const tsq = q ? sql`websearch_to_tsquery('english', ${q})` : null;
  const locations = (filters.locations ?? []).filter(Boolean).map((l) => `%${escapeLike(l)}%`);

  const linked = filters.profileId
    ? sql`id IN (SELECT job_id FROM profile_jobs WHERE profile_id = ${filters.profileId})`
    : null;

  const where = sql`
    WHERE ((TRUE
    ${filters.source ? sql`AND source = ${filters.source}` : sql``}
    ${filters.sources?.length ? sql`AND source = ANY(${filters.sources})` : sql``}
    ${filters.remote ? sql`AND remote` : sql``}
    ${locations.length ? sql`AND (location ILIKE ANY(${locations}) ${filters.remote ? sql`` : sql`OR remote`})` : sql``}
    ${tsq ? sql`AND search @@ ${tsq}` : sql``})
    ${linked ? sql`OR ${linked}` : sql``})
    ${filters.acceptedOpenTo ? sql`AND (NOT remote OR open_to IS NULL OR open_to && ${filters.acceptedOpenTo})` : sql``}
  `;
  // Site-matched jobs get a small boost so they rank among the full-text matches.

  // Claude scores from the profile's latest CV, if any: best fits first.
  const matchJoin = filters.profileId
    ? sql`LEFT JOIN cv_matches m ON m.job_id = jobs.id AND m.cv_id =
        (SELECT id FROM cvs WHERE profile_id = ${filters.profileId} ORDER BY created_at DESC LIMIT 1)`
    : sql``;
  const matchCols = filters.profileId
    ? sql`, m.score AS match_score, m.summary AS match_summary, m.missing_skills AS match_missing`
    : sql``;
  const byScore = filters.profileId ? sql`m.score DESC NULLS LAST,` : sql``;
  const orderBy = tsq
    ? sql`ORDER BY ${byScore} ts_rank_cd(search, ${tsq}) ${linked ? sql`+ CASE WHEN ${linked} THEN 0.1 ELSE 0 END` : sql``} DESC,
          COALESCE(posted_at, first_seen_at) DESC`
    : sql`ORDER BY ${byScore} COALESCE(posted_at, first_seen_at) DESC, id DESC`;

  const [rows, [{ count }]] = await Promise.all([
    sql`SELECT ${sql.unsafe(JOB_COLUMNS)} ${matchCols} FROM jobs ${matchJoin} ${where} ${orderBy}
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    sql<{ count: number }[]>`SELECT count(*)::int AS count FROM jobs ${where}`,
  ]);
  return { total: count, jobs: rows.map(toJob) };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJob(r: any): Job {
  return {
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
    openTo: r.open_to ?? null,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    match:
      r.match_score == null
        ? null
        : { score: r.match_score, summary: r.match_summary, missingSkills: r.match_missing ?? [] },
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
