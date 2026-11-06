import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { JobDetail } from "@ujc/core";
import { jobMetaDescription } from "./job-posting";
import { JobSeo } from "./job-seo";

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "42",
    source: "himalayas",
    url: "https://example.com/42",
    applyUrl: null,
    title: "Senior Next.js Engineer",
    company: "Acme",
    location: "Berlin, Germany",
    remote: true,
    employmentType: "Full-time",
    salaryText: "€70k–90k",
    tags: [],
    openTo: ["DE", "EUROPE"],
    postedAt: "2026-11-01T00:00:00Z",
    firstSeenAt: "2026-11-02T00:00:00Z",
    salary: { min: 70000, max: 90000, currency: "EUR", period: "year", source: "source" },
    description: "Build <b>great</b> things with Next.js.",
    ...overrides,
  };
}

afterEach(cleanup);

describe("JobSeo (/jobs/view/)", () => {
  it("sets the page title and description, then restores them on unmount", () => {
    document.title = "JobSeeking";
    const { unmount } = render(<JobSeo job={job()} />);
    expect(document.title).toBe("Senior Next.js Engineer at Acme · JobSeeking");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(jobMetaDescription(job()));
    unmount();
    expect(document.title).toBe("JobSeeking");
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });

  it("adds no canonical and no JobPosting (the static /jobs/<slug>/ page owns those)", () => {
    render(<JobSeo job={job()} />);
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
