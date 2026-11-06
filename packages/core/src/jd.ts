// Parsed job description: canonical sections and seniority level. Written by the crawler
// (apps/crawler job_crawler/sections.py, level.py), served by `GET /api/jobs/{id}` / `GET /api/jobs`.

/** Seniority, low to high (job_crawler.level.LEVELS). */
export const JOB_LEVELS = ["intern", "junior", "mid", "senior", "lead", "manager", "director"] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

export function isJobLevel(value: unknown): value is JobLevel {
  return typeof value === "string" && (JOB_LEVELS as readonly string[]).includes(value);
}

/** Canonical description sections, in the order the job detail shows them
 * (job_crawler.sections.SECTION_KEYS). */
export const JD_SECTION_KEYS = [
  "intro",
  "about_company",
  "about_role",
  "responsibilities",
  "requirements",
  "nice_to_have",
  "tech_stack",
  "compensation",
  "benefits",
  "location_remote",
  "hiring_process",
  "other",
  "equal_opportunity",
] as const;
export type JdSectionKey = (typeof JD_SECTION_KEYS)[number];

/** One section of a description, as the posting wrote it. */
export interface JdSection {
  key: JdSectionKey;
  /** The posting's own heading ("What you'll bring"); null for the text before the first one. */
  heading: string | null;
  /** The section's text: plain text, one block per line, list items as "- …". */
  body: string;
  /** A short plain-text digest (first bullets or sentences). */
  summary: string;
}
