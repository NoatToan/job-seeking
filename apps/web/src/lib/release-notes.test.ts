import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The same rules the GitHub Actions generator applies before it commits an entry.
import { validateAiOutput, validateEntry, validateReleaseNotes } from "../../../../scripts/release-notes/schema.mjs";
import { activitySince, atomFeed, heatLevel, heatmapWeeks, RELEASE_NOTES } from "./release-notes";
import type { ReleaseEntry } from "./release-notes";

const entry = (date: string, highlights: number, commits: number, slug = date): ReleaseEntry => ({
  date,
  slug,
  title: { en: `Title ${date}`, vi: `Tiêu đề ${date}` },
  highlights: Array.from({ length: highlights }, (_, i) => ({ category: "new" as const, en: `Thing ${i}`, vi: `Điều ${i}` })),
  commits: { from: "aaaaaaa", to: "bbbbbbb", count: commits },
});

describe("committed release notes", () => {
  it("match the schema (newest first, unique slugs, en + vi everywhere)", () => {
    expect(validateReleaseNotes(RELEASE_NOTES)).toEqual([]);
    expect(RELEASE_NOTES.entries.length).toBeGreaterThan(0);
  });

  it("point at screenshots that exist in public/", () => {
    for (const e of RELEASE_NOTES.entries) {
      if (e.screenshot) expect(existsSync(path.join(process.cwd(), "public", e.screenshot))).toBe(true);
    }
  });
});

describe("schema", () => {
  it("rejects missing translations, unknown categories, multi-line text and bad ranges", () => {
    const bad = {
      ...entry("2026-11-07", 1, 1),
      title: { en: "Ok", vi: "" },
      highlights: [{ category: "misc", en: "One\ntwo", vi: "x" }],
      commits: { from: "nope", to: "bbbbbbb", count: 0 },
    };
    const errors = validateEntry(bad).join("\n");
    expect(errors).toMatch(/title\.vi/);
    expect(errors).toMatch(/category/);
    expect(errors).toMatch(/one line/);
    expect(errors).toMatch(/commits\.from/);
    expect(errors).toMatch(/commits\.count/);
  });

  it("rejects an older entry above a newer one and duplicate slugs", () => {
    const errors = validateReleaseNotes({
      version: 1,
      entries: [entry("2026-11-01", 1, 1), entry("2026-11-02", 1, 1), entry("2026-11-01", 1, 1)],
    }).join("\n");
    expect(errors).toMatch(/newest first/);
    expect(errors).toMatch(/used twice/);
  });

  it("accepts a skip from the model without a title", () => {
    expect(validateAiOutput({ skip: true, title: { en: "", vi: "" }, highlights: [] })).toEqual([]);
    expect(validateAiOutput({ skip: false, title: { en: "", vi: "" }, highlights: [] })).not.toEqual([]);
  });
});

describe("activity", () => {
  const entries = [entry("2026-11-07", 3, 6), entry("2026-11-06", 2, 20, "2026-11-06-2"), entry("2026-11-06", 4, 30), entry("2026-10-01", 5, 9)];

  it("counts highlights, release days and commits in the last 30 days", () => {
    expect(activitySince(entries, "2026-11-07")).toEqual({ updates: 9, days: 2, commits: 56 });
    // 2026-10-09 is the 30th day back from 2026-11-07; 2026-10-01 stays out.
    expect(activitySince(entries, "2026-12-07").updates).toBe(0);
  });

  it("lays out 12 Monday-first weeks ending with today, summing a day's entries", () => {
    const weeks = heatmapWeeks(entries, "2026-11-07");
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const last = weeks[11];
    expect(last[0].date).toBe("2026-11-02"); // Monday
    expect(last.find((d) => d.date === "2026-11-06")?.commits).toBe(50);
    expect(last.find((d) => d.date === "2026-11-08")?.future).toBe(true);
    expect([0, 1, 3, 9, 10, 30].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 4]);
  });
});

describe("atom feed", () => {
  it("lists every entry with an id, a link and escaped HTML content", () => {
    const xml = atomFeed([{ ...entry("2026-11-07", 1, 1), title: { en: "Tom & Jerry <3", vi: "x" } }], "https://example.test", "JobSeeking");
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain("<id>https://example.test/release-notes/#2026-11-07</id>");
    expect(xml).toContain("<title>Tom &amp; Jerry &lt;3</title>");
    expect(xml).toContain("<updated>2026-11-07T12:00:00+07:00</updated>");
    expect(xml).toContain("&lt;li&gt;&lt;strong&gt;New:&lt;/strong&gt; Thing 0&lt;/li&gt;");
    expect(xml).toContain('href="https://example.test/release-notes/feed.xml"');
  });
});
