// Pure helpers for notify.mjs (no network, no database), covered by plan.test.mjs.

/** `<loc>` values of a sitemap (or sitemap index), in document order. */
export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

/** The job sitemaps listed in robots.txt (`/jobs/sitemap/<n>.xml`). */
export function jobSitemapsFromRobots(robots) {
  return [...robots.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)]
    .map((m) => m[1])
    .filter((u) => /\/jobs\/sitemap\/\d+\.xml$/.test(u));
}

/**
 * What to send today.
 *
 * - `live`: the job page URLs in the live sitemaps, newest first.
 * - `notices`: Map url -> last kind sent ("URL_UPDATED" | "URL_DELETED").
 * - `quota`: requests allowed this run.
 *
 * Withdrawals go first (Google asks job sites to remove expired postings quickly), then pages
 * never announced (or announced as deleted and live again), newest first. Returns null when the
 * live set looks broken (empty, or under half of what is currently announced): a bad deploy must
 * never withdraw the whole catalogue.
 */
export function planNotices(live, notices, quota) {
  const liveSet = new Set(live);
  const announced = [...notices].filter(([, kind]) => kind === "URL_UPDATED").map(([url]) => url);
  if (live.length === 0 || (announced.length > 0 && live.length < announced.length / 2)) return null;
  const deletions = announced.filter((url) => !liveSet.has(url)).map((url) => ({ url, type: "URL_DELETED" }));
  const updates = live.filter((url) => notices.get(url) !== "URL_UPDATED").map((url) => ({ url, type: "URL_UPDATED" }));
  return [...deletions, ...updates].slice(0, Math.max(0, quota));
}
