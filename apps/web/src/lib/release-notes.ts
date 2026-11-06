import data from "@/content/release-notes.json";

/**
 * Release notes (`/release-notes/`): `src/content/release-notes.json`, written by
 * scripts/release-notes/generate.mjs (Claude, on every push to main) and checked by
 * scripts/release-notes/schema.mjs. Newest entry first.
 */
export type ReleaseCategory = "new" | "improved" | "fixed" | "under-the-hood";
export const RELEASE_CATEGORIES: readonly ReleaseCategory[] = ["new", "improved", "fixed", "under-the-hood"];

export interface Localized {
  en: string;
  vi: string;
}

export interface ReleaseHighlight extends Localized {
  category: ReleaseCategory;
}

export interface ReleaseEntry {
  /** Local calendar day (Asia/Ho_Chi_Minh), `YYYY-MM-DD`. */
  date: string;
  /** Anchor and feed id: the date, or `date-2` when a day has more than one entry. */
  slug: string;
  title: Localized;
  highlights: ReleaseHighlight[];
  /** Image under `public/`, e.g. `/release-notes/2026-11-06-home.jpg`. */
  screenshot?: string;
  /** Commits on main this entry covers (`to` is the anchor for the next run). */
  commits: { from: string; to: string; count: number };
}

export interface ReleaseNotes {
  version: 1;
  entries: ReleaseEntry[];
}

export const RELEASE_NOTES = data as ReleaseNotes;

/** `YYYY-MM-DD` of a moment in the viewer's own time zone. */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days between two `YYYY-MM-DD` dates (b - a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export interface Activity {
  /** Highlights shipped in the window. */
  updates: number;
  /** Distinct days with an entry in the window. */
  days: number;
  /** Commits to main in the window. */
  commits: number;
}

/** Activity over the last `windowDays` days, today included. */
export function activitySince(entries: ReleaseEntry[], today: string, windowDays = 30): Activity {
  const recent = entries.filter((e) => {
    const age = dayDiff(e.date, today);
    return age >= 0 && age < windowDays;
  });
  return {
    updates: recent.reduce((n, e) => n + e.highlights.length, 0),
    days: new Set(recent.map((e) => e.date)).size,
    commits: recent.reduce((n, e) => n + e.commits.count, 0),
  };
}

export interface HeatmapDay {
  date: string;
  commits: number;
  /** 0 (nothing) to 4 (busiest). */
  level: 0 | 1 | 2 | 3 | 4;
  /** After `today`: drawn empty. */
  future: boolean;
}

export function heatLevel(commits: number): HeatmapDay["level"] {
  if (commits <= 0) return 0;
  if (commits < 3) return 1;
  if (commits < 10) return 2;
  if (commits < 30) return 3;
  return 4;
}

/**
 * Commit days for the last `weeks` weeks as week columns (Monday first, 7 days each), the last
 * column holding `today`, like a contribution graph.
 */
export function heatmapWeeks(entries: ReleaseEntry[], today: string, weeks = 12): HeatmapDay[][] {
  const perDay = new Map<string, number>();
  for (const e of entries) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.commits.count);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -weekday - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      const commits = perDay.get(date) ?? 0;
      return { date, commits, level: heatLevel(commits), future: date > today };
    }),
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

const CATEGORY_LABEL: Record<ReleaseCategory, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  "under-the-hood": "Under the hood",
};

/** Atom feed of the entries (English), served at `/release-notes/feed.xml`. */
export function atomFeed(entries: ReleaseEntry[], siteUrl: string, siteName: string): string {
  const page = `${siteUrl}/release-notes/`;
  // Entries are local (UTC+7) days; noon there keeps the feed date on the same calendar day.
  const stamp = (date: string) => `${date}T12:00:00+07:00`;
  const items = entries.map((e) => {
    const list = e.highlights
      .map((h) => `<li><strong>${escapeXml(CATEGORY_LABEL[h.category])}:</strong> ${escapeXml(h.en)}</li>`)
      .join("");
    return [
      "  <entry>",
      `    <id>${escapeXml(`${page}#${e.slug}`)}</id>`,
      `    <title>${escapeXml(e.title.en)}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(`${page}#${e.slug}`)}"/>`,
      `    <updated>${stamp(e.date)}</updated>`,
      `    <content type="html">${escapeXml(`<ul>${list}</ul>`)}</content>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(page)}</id>`,
    `  <title>${escapeXml(`${siteName} release notes`)}</title>`,
    `  <subtitle>Every notable change to ${escapeXml(siteName)}, day by day.</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(`${page}feed.xml`)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(page)}"/>`,
    `  <updated>${entries[0] ? stamp(entries[0].date) : new Date(0).toISOString()}</updated>`,
    `  <author><name>${escapeXml(siteName)}</name></author>`,
    ...items,
    "</feed>",
    "",
  ].join("\n");
}
