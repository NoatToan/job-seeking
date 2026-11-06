/** Structured data and meta text for one job. Pure functions, usable at build time (static job
 * pages) and in the browser. */
import type { JobDetail } from "@ujc/core";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { jobPagePath } from "@/lib/job-url";

const PERIOD_UNIT = { year: "YEAR", month: "MONTH", week: "WEEK", day: "DAY", hour: "HOUR" } as const;

const EMPLOYMENT_TYPES: Array<[RegExp, string]> = [
  [/full[\s-]?time|permanent/i, "FULL_TIME"],
  [/part[\s-]?time/i, "PART_TIME"],
  [/contract|freelance/i, "CONTRACTOR"],
  [/temp/i, "TEMPORARY"],
  [/intern/i, "INTERN"],
];

/** Plain-text description as the simple HTML Google asks for in `JobPosting.description`:
 * escaped, blank lines become paragraphs, single newlines `<br>`. */
export function descriptionHtml(text: string): string {
  const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escape(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export interface JobPostingExtras {
  /** ISO countries the job is in or open to (`jobs.countries`); one = the office's country. */
  countries?: readonly string[] | null;
}

/**
 * schema.org `JobPosting` for one job (Google job search rich results), published on the static
 * job page (`/jobs/<slug>/`) only. Uses only fields we really have; returns null when a field
 * Google requires is missing (no description), so we never publish invalid structured data.
 * `validThrough` is left out on purpose: boards rarely send a closing date, and a job that stops
 * appearing in the crawl is dropped from the next build instead (its URL then answers 404).
 */
export function jobPostingJsonLd(job: JobDetail, extras: JobPostingExtras = {}): Record<string, unknown> | null {
  if (!job.description?.trim()) return null;
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: descriptionHtml(job.description),
    datePosted: job.postedAt ?? job.firstSeenAt,
    url: `${SITE_URL}${jobPagePath(job)}`,
    identifier: { "@type": "PropertyValue", name: SITE_NAME, value: job.id },
    hiringOrganization: { "@type": "Organization", name: job.company },
    directApply: false,
  };
  const type = job.employmentType && EMPLOYMENT_TYPES.find(([re]) => re.test(job.employmentType ?? ""))?.[1];
  if (type) out.employmentType = type;
  const countries = (extras.countries ?? []).filter((c) => /^[A-Z]{2}$/.test(c));
  // Remote: who may apply goes in applicantLocationRequirements (the stated countries, else the
  // countries we derived from the posting). An office address is only added for a remote job
  // when no country is known at all, so the posting still says where it is.
  const applicantCountries = job.remote
    ? ((job.openTo ?? []).some((t) => /^[A-Z]{2}$/.test(t))
        ? (job.openTo ?? []).filter((t) => /^[A-Z]{2}$/.test(t))
        : (job.openTo ?? []).includes("WORLDWIDE")
          ? []
          : countries)
    : [];
  if (job.remote) {
    out.jobLocationType = "TELECOMMUTE";
    if (applicantCountries.length) {
      out.applicantLocationRequirements = applicantCountries.map((name) => ({ "@type": "Country", name }));
    }
  }
  const placeholder = /^\s*(remote|anywhere|worldwide)\b/i.test(job.location ?? "");
  if (job.location && !placeholder && (!job.remote || !applicantCountries.length)) {
    out.jobLocation = {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location,
        ...(countries.length === 1 ? { addressCountry: countries[0] } : {}),
      },
    };
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

/** JSON for a `<script type="application/ld+json">`: `<` escaped so text from a job posting can
 * never close the script tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Plain-text summary for `<meta name="description">`, at most ~155 characters. */
export function jobMetaDescription(job: JobDetail): string {
  const head = [job.company, job.location ?? (job.remote ? "Remote" : null), job.salaryText].filter(Boolean).join(" · ");
  const body = (job.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const text = body ? `${head}. ${body}` : head;
  return text.length > 155 ? `${text.slice(0, 152).trimEnd()}…` : text;
}
