import { describe, expect, it } from "vitest";
import type { JobDetail } from "@ujc/core";
import { descriptionHtml, jobMetaDescription, jobPostingJsonLd, jsonLdString } from "./job-posting";

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

describe("jobPostingJsonLd", () => {
  it("maps a job to a schema.org JobPosting on its static page", () => {
    const ld = jobPostingJsonLd(job(), { countries: ["DE"] });
    expect(ld).toMatchObject({
      "@type": "JobPosting",
      title: "Senior Next.js Engineer",
      datePosted: "2026-11-01T00:00:00Z",
      hiringOrganization: { "@type": "Organization", name: "Acme" },
      identifier: { "@type": "PropertyValue", value: "42" },
      directApply: false,
      employmentType: "FULL_TIME",
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: [{ "@type": "Country", name: "DE" }],
      baseSalary: { currency: "EUR", value: { minValue: 70000, maxValue: 90000, unitText: "YEAR" } },
    });
    expect(ld?.url).toBe("https://unified-job-crawler.vercel.app/jobs/senior-next-js-engineer-acme-42/");
    expect(ld).not.toHaveProperty("validThrough");
    // Remote with known applicant countries: no office address.
    expect(ld).not.toHaveProperty("jobLocation");
  });

  it("uses the derived countries for a remote job that names none, and none for worldwide", () => {
    expect(jobPostingJsonLd(job({ openTo: null }), { countries: ["US"] })?.applicantLocationRequirements).toEqual([
      { "@type": "Country", name: "US" },
    ]);
    const worldwide = jobPostingJsonLd(job({ openTo: ["WORLDWIDE"] }), { countries: ["DE"] });
    expect(worldwide).not.toHaveProperty("applicantLocationRequirements");
    // Nothing says who may apply, so the posting keeps its location.
    expect(worldwide?.jobLocation).toMatchObject({ address: { addressLocality: "Berlin, Germany", addressCountry: "DE" } });
  });

  it("publishes the description as escaped HTML", () => {
    expect(jobPostingJsonLd(job())?.description).toBe("<p>Build &lt;b&gt;great&lt;/b&gt; things with Next.js.</p>");
  });

  it("returns null without a description (a required field)", () => {
    expect(jobPostingJsonLd(job({ description: null }))).toBeNull();
    expect(jobPostingJsonLd(job({ description: "   " }))).toBeNull();
  });

  it("leaves out jobLocation for a remote job whose location is just 'Remote'", () => {
    const ld = jobPostingJsonLd(job({ location: "Remote", openTo: ["WORLDWIDE"] }));
    expect(ld).not.toHaveProperty("jobLocation");
    expect(ld).not.toHaveProperty("applicantLocationRequirements");
    expect(ld?.jobLocationType).toBe("TELECOMMUTE");
  });

  it("puts on-site jobs at their location, without addressCountry when it spans several countries", () => {
    const ld = jobPostingJsonLd(job({ remote: false }), { countries: ["DE", "FR"] });
    expect(ld?.jobLocation).toEqual({
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Berlin, Germany" },
    });
    expect(ld).not.toHaveProperty("jobLocationType");
  });

  it("skips baseSalary without a currency or period", () => {
    const ld = jobPostingJsonLd(job({ salary: { min: 1, max: 2, currency: null, period: "year", source: "description" } }));
    expect(ld).not.toHaveProperty("baseSalary");
  });
});

describe("descriptionHtml", () => {
  it("turns blank lines into paragraphs and single newlines into <br>", () => {
    expect(descriptionHtml("One\ntwo\n\nThree & four")).toBe("<p>One<br>two</p><p>Three &amp; four</p>");
  });
});

describe("jsonLdString", () => {
  it("escapes < so a posting can never close the script tag", () => {
    expect(jsonLdString({ d: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});

describe("jobMetaDescription", () => {
  it("strips tags and keeps it short", () => {
    const text = jobMetaDescription(job({ description: "<p>" + "word ".repeat(80) + "</p>" }));
    expect(text).not.toContain("<");
    expect(text.length).toBeLessThanOrEqual(155);
    expect(text.startsWith("Acme · Berlin, Germany · €70k–90k. ")).toBe(true);
  });
});
