/**
 * Build-time access to the job snapshot (`scripts/seo-snapshot.mjs` → `apps/web/.seo/jobs.json`)
 * for the static SEO pages: job pages, tech / country / source listings and the job sitemaps.
 * Only imported by server components and metadata routes, which run during `next build`; nothing
 * here reaches the browser bundle.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { JobDetail } from "@ujc/core";
import { isSourceId, sortTech, sourceMeta, techInfo, TECH_STACK } from "@ujc/core";

/** One job as the snapshot stores it: the API's `JobDetail` plus a few columns for SEO. */
export interface SeoJob extends JobDetail {
  /** Last time a crawl still found the job (`jobs.last_seen_at`): the sitemap's `lastmod`. */
  lastSeenAt: string;
  /** ISO countries the job is in or open to (`jobs.countries`). */
  countries: string[];
}

export interface Snapshot {
  generatedAt: string;
  jobs: SeoJob[];
}

/** A listing page needs at least this many jobs to be worth indexing (no thin pages). */
export const MIN_LISTING_JOBS = 3;
/** Jobs shown on one listing page (newest first); the rest are reachable via the sitemap. */
export const LISTING_PAGE_SIZE = 60;
/** Related jobs under a job page. */
export const RELATED_JOBS = 6;

const listingCache = new Map<ListingKind, Listing[]>();
let cached: { snapshot: Snapshot; byId: Map<string, SeoJob> } | null = null;

function snapshotPath(): string {
  // `next build` runs in apps/web; vitest may run from the repo root.
  const local = path.join(process.cwd(), ".seo", "jobs.json");
  return process.env.SEO_SNAPSHOT_PATH ?? local;
}

function load() {
  if (cached) return cached;
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath(), "utf8")) as Snapshot;
  } catch {
    // No snapshot yet (`next dev` without running the script): no job pages, nothing breaks.
    snapshot = { generatedAt: new Date(0).toISOString(), jobs: [] };
  }
  cached = { snapshot, byId: new Map(snapshot.jobs.map((j) => [j.id, j])) };
  return cached;
}

/**
 * `output: "export"` refuses a dynamic route whose `generateStaticParams` is empty (a build with
 * no snapshot: CI, a laptop without a database). Such a build exports this one placeholder
 * instead; its page calls `notFound()`, so it is never a real page, and it is never linked or
 * listed in a sitemap.
 */
export const PLACEHOLDER_PARAM = "_none";

export function withPlaceholder<T extends Record<string, string>>(params: T[], key: keyof T): T[] {
  return params.length ? params : [{ [key]: PLACEHOLDER_PARAM } as T];
}

/** Test hook: use this snapshot instead of the file. */
export function setSnapshotForTests(snapshot: Snapshot | null): void {
  listingCache.clear();
  cached = snapshot ? { snapshot, byId: new Map(snapshot.jobs.map((j) => [j.id, j])) } : null;
}

export function snapshotDate(): string {
  return load().snapshot.generatedAt;
}

/** Every active job, newest first. */
export function allJobs(): readonly SeoJob[] {
  return load().snapshot.jobs;
}

export function jobById(id: string): SeoJob | null {
  return load().byId.get(id) ?? null;
}

/** Jobs for "More jobs like this": same company first, then the most shared technologies, newest
 * first within a tie. */
export function relatedJobs(job: SeoJob, limit = RELATED_JOBS): SeoJob[] {
  const tech = new Set(job.techStack ?? []);
  const scored: Array<{ job: SeoJob; score: number; index: number }> = [];
  allJobs().forEach((other, index) => {
    if (other.id === job.id) return;
    let score = 0;
    if (other.company === job.company) score += 10;
    for (const t of other.techStack ?? []) if (tech.has(t)) score += 1;
    if (score > 0) scored.push({ job: other, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.job);
}

// --- Listing pages ---------------------------------------------------------------------------

export type ListingKind = "tech" | "country" | "source";

export interface Listing {
  kind: ListingKind;
  /** URL segment: tech id, lowercase ISO country, source id. */
  key: string;
  /** "React", "Germany", "Himalayas". */
  label: string;
  jobs: SeoJob[];
}

function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function group(keysOf: (job: SeoJob) => readonly string[]): Map<string, SeoJob[]> {
  const groups = new Map<string, SeoJob[]>();
  for (const job of allJobs()) {
    for (const key of new Set(keysOf(job))) {
      const list = groups.get(key);
      if (list) list.push(job);
      else groups.set(key, [job]);
    }
  }
  return groups;
}

const KEYS: Record<ListingKind, (job: SeoJob) => readonly string[]> = {
  tech: (job) => job.techStack ?? [],
  country: (job) => (job.countries ?? []).filter((c) => /^[A-Z]{2}$/.test(c)).map((c) => c.toLowerCase()),
  source: (job) => (isSourceId(job.source) ? [job.source] : []),
};

function labelFor(kind: ListingKind, key: string): string {
  if (kind === "tech") return techInfo(key).label;
  if (kind === "country") return countryLabel(key.toUpperCase());
  return sourceMeta(key).label;
}

/** Every listing of a kind with enough jobs to be indexed, biggest first. */
export function listings(kind: ListingKind): Listing[] {
  const hit = listingCache.get(kind);
  if (hit) return hit;
  const known = kind === "tech" ? new Set(TECH_STACK.map((t) => t.id)) : null;
  const out: Listing[] = [];
  for (const [key, jobs] of group(KEYS[kind])) {
    if (jobs.length < MIN_LISTING_JOBS || (known && !known.has(key))) continue;
    out.push({ kind, key, label: labelFor(kind, key), jobs });
  }
  out.sort((a, b) => b.jobs.length - a.jobs.length || a.label.localeCompare(b.label));
  if (kind === "tech") {
    // Catalogue order reads better than raw counts for the tech chips' tie-breaks.
    const order = new Map(sortTech(out.map((l) => l.key)).map((k, i) => [k, i]));
    out.sort((a, b) => b.jobs.length - a.jobs.length || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  }
  listingCache.set(kind, out);
  return out;
}

export function listing(kind: ListingKind, key: string): Listing | null {
  return listings(kind).find((l) => l.key === key) ?? null;
}

/** Home page filter link that shows the same jobs live (filters live in the URL, see url-state). */
export function homeFilterHref(kind: ListingKind, key: string): string {
  if (kind === "tech") return `/?tech=${encodeURIComponent(key)}`;
  if (kind === "country") return `/?country=${encodeURIComponent(key.toUpperCase())}`;
  return `/?source=${encodeURIComponent(key)}`;
}
