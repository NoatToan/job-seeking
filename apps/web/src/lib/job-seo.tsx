"use client";

import { useEffect } from "react";
import type { JobDetail } from "@ujc/core";
import { SITE_NAME, SITE_URL } from "@/lib/site";

const PERIOD_UNIT = { year: "YEAR", month: "MONTH", week: "WEEK", day: "DAY", hour: "HOUR" } as const;

const EMPLOYMENT_TYPES: Array<[RegExp, string]> = [
  [/full[\s-]?time|permanent/i, "FULL_TIME"],
  [/part[\s-]?time/i, "PART_TIME"],
  [/contract|freelance/i, "CONTRACTOR"],
  [/temp/i, "TEMPORARY"],
  [/intern/i, "INTERN"],
];

/**
 * schema.org `JobPosting` for one job (Google job search rich results). Returns null when a field
 * Google requires is missing (no description), so we never publish invalid structured data.
 */
export function jobPostingJsonLd(job: JobDetail): Record<string, unknown> | null {
  if (!job.description) return null;
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted: job.postedAt ?? job.firstSeenAt,
    url: `${SITE_URL}/jobs/view/?id=${encodeURIComponent(job.id)}`,
    hiringOrganization: { "@type": "Organization", name: job.company },
    directApply: false,
  };
  const type = job.employmentType && EMPLOYMENT_TYPES.find(([re]) => re.test(job.employmentType ?? ""))?.[1];
  if (type) out.employmentType = type;
  if (job.location) {
    out.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location } };
  }
  if (job.remote) {
    out.jobLocationType = "TELECOMMUTE";
    const countries = (job.openTo ?? []).filter((t) => /^[A-Z]{2}$/.test(t));
    if (countries.length) out.applicantLocationRequirements = countries.map((name) => ({ "@type": "Country", name }));
  }
  const s = job.salary;
  if (s && s.currency && s.period && (s.min !== null || s.max !== null)) {
    out.baseSalary = {
      "@type": "MonetaryAmount",
      currency: s.currency,
      value: {
        "@type": "QuantitativeValue",
        ...(s.min !== null ? { minValue: s.min } : {}),
        ...(s.max !== null ? { maxValue: s.max } : {}),
        unitText: PERIOD_UNIT[s.period],
      },
    };
  }
  return out;
}

/** Plain-text summary for `<meta name="description">`, at most ~155 characters. */
export function jobMetaDescription(job: JobDetail): string {
  const head = [job.company, job.location ?? (job.remote ? "Remote" : null), job.salaryText].filter(Boolean).join(" · ");
  const body = (job.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = body ? `${head}. ${body}` : head;
  return text.length > 155 ? `${text.slice(0, 152).trimEnd()}…` : text;
}

function setMeta(selector: string, attr: "name" | "property", key: string, value: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !el;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const previous = el.content;
  el.content = value;
  return () => {
    if (created) el.remove();
    else el.content = previous;
  };
}

/**
 * Job pages are rendered in the browser (static export, `?id=`), so their title, description and
 * canonical are set here once the job loads, and restored on leaving. Google renders JavaScript
 * and reads both these and the `JobPosting` JSON-LD.
 */
export function JobSeo({ job }: { job: JobDetail }) {
  useEffect(() => {
    const title = `${job.title} at ${job.company} · ${SITE_NAME}`;
    const description = jobMetaDescription(job);
    const url = `${SITE_URL}/jobs/view/?id=${encodeURIComponent(job.id)}`;
    const previousTitle = document.title;
    document.title = title;
    const restore = [
      setMeta('meta[name="description"]', "name", "description", description),
      setMeta('meta[property="og:title"]', "property", "og:title", title),
      setMeta('meta[property="og:description"]', "property", "og:description", description),
      setMeta('meta[property="og:url"]', "property", "og:url", url),
    ];
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const createdCanonical = !canonical;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    const previousCanonical = canonical.href;
    canonical.href = url;
    return () => {
      document.title = previousTitle;
      restore.forEach((r) => r());
      if (createdCanonical) canonical.remove();
      else canonical.href = previousCanonical;
    };
  }, [job]);

  const ld = jobPostingJsonLd(job);
  if (!ld) return null;
  return (
    <script
      type="application/ld+json"
      // `<` escaped so text from a job posting can never close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }}
    />
  );
}
