// Tells the Google Indexing API about new and removed static job pages (`/jobs/<slug>/`), so
// Google crawls them within hours instead of waiting to find them in the sitemap. The Indexing API
// is officially for pages with JobPosting (or BroadcastEvent) markup, which every job page has.
//
// Run daily after the rebuild (.github/workflows/google-indexing.yml):
// 1. reads the live job sitemaps listed in `${SITE_URL}/robots.txt` (what is really deployed);
// 2. diffs them with `seo_indexing_notices` (migration 035): pages never announced get
//    URL_UPDATED (newest first), announced pages no longer in the sitemap get URL_DELETED;
// 3. sends at most GOOGLE_INDEXING_DAILY_QUOTA requests (default 200, the API's default quota),
//    recording each success, so a backlog drains over the next days.
//
// Env:
// - GOOGLE_INDEXING_SA_JSON: a Google Cloud service account key (JSON) with the Indexing API
//   enabled; the service account's email must be an Owner of the site in Search Console. Unset =
//   the script ends with a notice and does nothing.
// - DATABASE_URL (required with the key), SITE_URL (default: the production URL),
//   GOOGLE_INDEXING_DAILY_QUOTA, GOOGLE_INDEXING_DRY_RUN=1 (print the plan, send nothing).
import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jobSitemapsFromRobots, planNotices, sitemapLocs } from "./plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const localEnv = path.join(root, ".env.local");
if (!process.env.DATABASE_URL && existsSync(localEnv)) process.loadEnvFile(localEnv);

const SITE_URL = (process.env.SITE_URL || "https://job-seeking-remote.vercel.app").replace(/\/$/, "");
const QUOTA = Number.parseInt(process.env.GOOGLE_INDEXING_DAILY_QUOTA ?? "", 10) || 200;
const DRY_RUN = process.env.GOOGLE_INDEXING_DRY_RUN === "1";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "JobSeeking-indexing/1.0" } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}

async function liveJobUrls() {
  const sitemaps = jobSitemapsFromRobots(await fetchText(`${SITE_URL}/robots.txt`));
  const urls = [];
  for (const sitemap of sitemaps) urls.push(...sitemapLocs(await fetchText(sitemap)));
  // Only this site's own job pages, whatever a sitemap might contain.
  return urls.filter((u) => u.startsWith(`${SITE_URL}/jobs/`));
}

const b64url = (data) => Buffer.from(data).toString("base64url");

/** OAuth access token for the service account (JWT bearer grant, no client library). */
async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/indexing",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

if (!process.env.GOOGLE_INDEXING_SA_JSON) {
  console.log("::notice::GOOGLE_INDEXING_SA_JSON is not set; skipping the Google Indexing API.");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("google-indexing: DATABASE_URL is not set");
  process.exit(1);
}

const key = JSON.parse(process.env.GOOGLE_INDEXING_SA_JSON);
const { default: postgres } = await import("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  const live = await liveJobUrls();
  const notices = new Map((await sql`SELECT url, kind FROM seo_indexing_notices`).map((r) => [r.url, r.kind]));
  const plan = planNotices(live, notices, QUOTA);
  if (plan === null) {
    console.error(`google-indexing: ${live.length} live job URLs vs ${notices.size} recorded; refusing to act`);
    process.exitCode = 1;
  } else if (DRY_RUN) {
    console.log(`google-indexing (dry run): ${live.length} live, would send ${plan.length}`);
    for (const n of plan.slice(0, 20)) console.log(`  ${n.type} ${n.url}`);
  } else {
    const token = plan.length ? await accessToken(key) : null;
    const sent = { URL_UPDATED: 0, URL_DELETED: 0 };
    for (const { url, type } of plan) {
      const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, type }),
      });
      if (res.status === 429) {
        console.log("google-indexing: daily quota reached; the rest goes tomorrow");
        break;
      }
      if (res.status === 401 || res.status === 403) {
        // Same answer for every URL: the service account is not an Owner in Search Console, or
        // the Indexing API is not enabled in its project.
        throw new Error(`Indexing API refused the request (HTTP ${res.status}); check the setup in docs/DEVELOPMENT.md`);
      }
      if (!res.ok) {
        console.warn(`google-indexing: ${type} ${url}: HTTP ${res.status}`);
        continue;
      }
      await sql`
        INSERT INTO seo_indexing_notices (url, kind) VALUES (${url}, ${type})
        ON CONFLICT (url) DO UPDATE SET kind = EXCLUDED.kind, notified_at = now()`;
      sent[type] += 1;
    }
    console.log(
      `google-indexing: ${live.length} live job pages; sent ${sent.URL_UPDATED} updated, ${sent.URL_DELETED} deleted`,
    );
  }
} finally {
  await sql.end();
}
