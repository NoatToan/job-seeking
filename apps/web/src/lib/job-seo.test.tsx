import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { JobDetail } from "@ujc/core";
import { JobSeo, jobMetaDescription, jobPostingJsonLd } from "./job-seo";

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

describe("jobPostingJsonLd", () => {
  it("maps a job to a schema.org JobPosting", () => {
    const ld = jobPostingJsonLd(job());
    expect(ld).toMatchObject({
      "@type": "JobPosting",
      title: "Senior Next.js Engineer",
      datePosted: "2026-11-01T00:00:00Z",
      hiringOrganization: { name: "Acme" },
      employmentType: "FULL_TIME",
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: [{ "@type": "Country", name: "DE" }],
      baseSalary: { currency: "EUR", value: { minValue: 70000, maxValue: 90000, unitText: "YEAR" } },
    });
    expect(ld?.url).toBe("https://unified-job-crawler.vercel.app/jobs/view/?id=42");
  });

  it("returns null without a description (a required field)", () => {
    expect(jobPostingJsonLd(job({ description: null }))).toBeNull();
  });
});

describe("JobSeo", () => {
  it("sets the page title and description, then restores them on unmount", () => {
    document.title = "JobSeeking";
    const { unmount } = render(<JobSeo job={job()} />);
    expect(document.title).toBe("Senior Next.js Engineer at Acme · JobSeeking");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(jobMetaDescription(job()));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toContain("/jobs/view/?id=42");
    expect(document.querySelector('script[type="application/ld+json"]')?.textContent).toContain('"JobPosting"');
    unmount();
    expect(document.title).toBe("JobSeeking");
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("strips tags from the meta description and keeps it short", () => {
    const text = jobMetaDescription(job({ description: "<p>" + "word ".repeat(80) + "</p>" }));
    expect(text).not.toContain("<");
    expect(text.length).toBeLessThanOrEqual(155);
  });
});
