import { afterEach, describe, expect, it } from "vitest";
import {
  allJobs,
  homeFilterHref,
  jobById,
  listing,
  listings,
  relatedJobs,
  setSnapshotForTests,
  type SeoJob,
} from "./seo-jobs";

function job(id: string, overrides: Partial<SeoJob> = {}): SeoJob {
  return {
    id,
    source: "himalayas",
    url: `https://example.com/${id}`,
    applyUrl: null,
    title: `Job ${id}`,
    company: `Company ${id}`,
    location: null,
    remote: true,
    employmentType: null,
    salaryText: null,
    tags: [],
    openTo: null,
    postedAt: null,
    firstSeenAt: "2026-11-01T00:00:00Z",
    lastSeenAt: "2026-11-05T00:00:00Z",
    techStack: [],
    countries: [],
    description: "A real description.",
    ...overrides,
  };
}

afterEach(() => setSnapshotForTests(null));

describe("seo-jobs", () => {
  it("reads jobs from the snapshot", () => {
    setSnapshotForTests({ generatedAt: "2026-11-06T00:00:00Z", jobs: [job("1"), job("2")] });
    expect(allJobs().map((j) => j.id)).toEqual(["1", "2"]);
    expect(jobById("2")?.title).toBe("Job 2");
    expect(jobById("3")).toBeNull();
  });

  it("only builds listings with enough jobs, biggest first, and skips unknown tech ids", () => {
    setSnapshotForTests({
      generatedAt: "2026-11-06T00:00:00Z",
      jobs: [
        job("1", { techStack: ["react", "python", "cobol"], countries: ["DE"] }),
        job("2", { techStack: ["react", "python", "cobol"], countries: ["DE"] }),
        job("3", { techStack: ["react", "cobol"], countries: ["DE", "EU"] }),
        job("4", { techStack: ["react"], source: "lever" }),
      ],
    });
    expect(listings("tech").map((l) => [l.key, l.jobs.length])).toEqual([["react", 4]]);
    // Countries need 10 jobs (MIN_LISTING_JOBS.country).
    expect(listings("country")).toEqual([]);
    expect(listings("source").map((l) => l.key)).toEqual(["himalayas"]);
    expect(listing("tech", "python")).toBeNull();
  });

  it("ranks related jobs: same company first, then shared tech, never the job itself", () => {
    const base = job("1", { company: "Acme", techStack: ["react", "nodejs"] });
    setSnapshotForTests({
      generatedAt: "2026-11-06T00:00:00Z",
      jobs: [
        base,
        job("2", { techStack: ["react"] }),
        job("3", { techStack: ["react", "nodejs"] }),
        job("4", { company: "Acme" }),
        job("5", { techStack: ["go"] }),
      ],
    });
    expect(relatedJobs(base).map((j) => j.id)).toEqual(["4", "3", "2"]);
  });

  it("labels country listings in English", () => {
    setSnapshotForTests({
      generatedAt: "2026-11-06T00:00:00Z",
      jobs: Array.from({ length: 10 }, (_, i) => job(String(i), { countries: ["DE"] })),
    });
    expect(listings("country").map((l) => [l.key, l.label, l.jobs.length])).toEqual([["de", "Germany", 10]]);
  });

  it("links listings to the live home filters", () => {
    expect(homeFilterHref("tech", "react")).toBe("/?tech=react");
    expect(homeFilterHref("country", "de")).toBe("/?country=DE");
    expect(homeFilterHref("source", "lever")).toBe("/?source=lever");
  });
});
