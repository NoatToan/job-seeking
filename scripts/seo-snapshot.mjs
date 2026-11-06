// Build-time snapshot of the live job catalogue for the static SEO pages (`/jobs/<slug>/`,
// `/jobs/tech/<id>/`, sitemaps). Runs right before `next build` (apps/web `build` script) and
// writes apps/web/.seo/jobs.json, which the pages read while they are prerendered. The browser
// never talks to the database: this is a read-only query at build time only
// (docs/product/ARCHITECTURE.md D12).
//
// - DATABASE_URL unset (CI, a laptop without .env.local): writes an empty snapshot, so the build
//   still works and simply has no job pages. On Vercel that would silently unpublish every job
//   page, so there it is an error instead.
// - DATABASE_URL set but the query fails: the build fails and the previous deployment stays live.
// - SEO_SNAPSHOT_FILE=<path>: use that JSON file as is (tests, local previews without a DB).
//
// "Active" = seen by a crawl in the last SEO_ACTIVE_DAYS days (default 14) and with a real
// description (Google needs one for JobPosting, and an empty page is thin content anyway).
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps", "web", ".seo");
const outFile = path.join(outDir, "jobs.json");

const ACTIVE_DAYS = positiveInt(process.env.SEO_ACTIVE_DAYS, 14);
const MAX_JOBS = positiveInt(process.env.SEO_MAX_JOBS, 20000);
const MIN_DESCRIPTION = 200;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

await mkdir(outDir, { recursive: true });

if (process.env.SEO_SNAPSHOT_FILE) {
  await copyFile(path.resolve(process.env.SEO_SNAPSHOT_FILE), outFile);
  console.log(`seo-snapshot: copied ${process.env.SEO_SNAPSHOT_FILE}`);
  process.exit(0);
}

const localEnv = path.join(root, ".env.local");
if (!process.env.DATABASE_URL && existsSync(localEnv)) process.loadEnvFile(localEnv);

if (!process.env.DATABASE_URL) {
  if (process.env.VERCEL === "1") {
    console.error("seo-snapshot: DATABASE_URL is not set on Vercel; refusing to publish a build without job pages");
    process.exit(1);
  }
  await writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), jobs: [] }));
  console.log("seo-snapshot: DATABASE_URL not set, wrote an empty snapshot (no job pages)");
  process.exit(0);
}

const { default: postgres } = await import("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));

// Mirrors apps/crawler job_crawler.salary `Salary.display()` for jobs whose board sent no text.
function salaryDisplay(min, max, currency, period) {
  const fmt = (v) =>
    Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let amount;
  if (min !== null && max !== null && min !== max) amount = `${fmt(min)} - ${fmt(max)}`;
  else if (min !== null && max === null) amount = `${fmt(min)}+`;
  else amount = fmt(max ?? min);
  let text = currency ? `${currency} ${amount}` : amount;
  if (min === null && max !== null) text = `Up to ${text}`;
  return period ? `${text} / ${period}` : text;
}

try {
  const rows = await sql.begin("read only", (tx) => tx`
    SELECT id, source, url, apply_url, title, company, location, remote, employment_type,
           salary_text, tags, open_to, posted_at, first_seen_at, last_seen_at, timezones,
           timezone_source, tech_stack, countries, salary_min, salary_max, salary_currency,
           salary_period, salary_source, description
    FROM jobs
    WHERE source <> 'upwork'
      AND last_seen_at > now() - make_interval(days => ${ACTIVE_DAYS})
      AND length(coalesce(description, '')) >= ${MIN_DESCRIPTION}
    ORDER BY coalesce(posted_at, first_seen_at) DESC, id DESC
    LIMIT ${MAX_JOBS}
  `);
  const jobs = rows.map((r) => {
    const min = num(r.salary_min);
    const max = num(r.salary_max);
    const salary = r.salary_source
      ? { min, max, currency: r.salary_currency, period: r.salary_period, source: r.salary_source }
      : null;
    return {
      id: String(r.id),
      source: r.source,
      url: r.url,
      applyUrl: r.apply_url,
      title: r.title,
      company: r.company,
      location: r.location,
      remote: Boolean(r.remote),
      employmentType: r.employment_type,
      salaryText: r.salary_text || (salary ? salaryDisplay(min, max, salary.currency, salary.period) : null),
      tags: r.tags ?? [],
      openTo: r.open_to ?? null,
      postedAt: iso(r.posted_at),
      firstSeenAt: iso(r.first_seen_at),
      lastSeenAt: iso(r.last_seen_at),
      timezones: r.timezones ?? null,
      timezoneSource: r.timezone_source,
      techStack: r.tech_stack ?? [],
      countries: r.countries ?? [],
      salary,
      description: r.description,
    };
  });
  await writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), jobs }));
  console.log(`seo-snapshot: ${jobs.length} active jobs (seen in the last ${ACTIVE_DAYS} days)`);
} finally {
  await sql.end();
}
