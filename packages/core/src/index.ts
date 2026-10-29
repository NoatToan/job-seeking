export * from "./sources";
export * from "./api";

/** A job as the apps see it (one row of the jobs table). */
export interface Job {
  id: string;
  source: string;
  url: string;
  applyUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  employmentType: string | null;
  salaryText: string | null;
  tags: string[];
  /** remote jobs: who may apply (WORLDWIDE / country codes / regions); null = unknown */
  openTo: string[] | null;
  postedAt: string | null;
  firstSeenAt: string;
  /** Claude's fit score for the profile's latest CV (job_crawler.matching), if scored */
  match?: { score: number; summary: string; missingSkills: string[] } | null;
}

/**
 * Candidate locations for "I'm based in". `accepts` lists the open_to tokens (see
 * apps/crawler eligibility.py) that make a remote job open to someone living there.
 */
export const CANDIDATE_COUNTRIES = [
  { code: "VN", label: "Vietnam", accepts: ["WORLDWIDE", "VN", "APAC", "ASIA", "SEA"] },
  { code: "AU", label: "Australia", accepts: ["WORLDWIDE", "AU", "APAC", "OCEANIA"] },
  { code: "SG", label: "Singapore", accepts: ["WORLDWIDE", "SG", "APAC", "ASIA", "SEA"] },
  { code: "PH", label: "Philippines", accepts: ["WORLDWIDE", "PH", "APAC", "ASIA", "SEA"] },
  { code: "IN", label: "India", accepts: ["WORLDWIDE", "IN", "APAC", "ASIA"] },
  { code: "JP", label: "Japan", accepts: ["WORLDWIDE", "JP", "APAC", "ASIA"] },
  { code: "GB", label: "United Kingdom", accepts: ["WORLDWIDE", "GB", "EUROPE", "EMEA"] },
  { code: "DE", label: "Germany", accepts: ["WORLDWIDE", "DE", "EUROPE", "EMEA"] },
  { code: "US", label: "United States", accepts: ["WORLDWIDE", "US", "NORTH_AMERICA", "AMERICAS"] },
  { code: "CA", label: "Canada", accepts: ["WORLDWIDE", "CA", "NORTH_AMERICA", "AMERICAS"] },
] as const;

export function acceptedTokens(country: string | null | undefined): string[] | null {
  const c = CANDIDATE_COUNTRIES.find((x) => x.code === country);
  return c ? [...c.accepts] : null;
}

/** Short label for a job's open_to tokens, e.g. "Worldwide" or "US, CA". */
export function openToLabel(openTo: string[] | null | undefined): string | null {
  if (!openTo?.length) return null;
  if (openTo.includes("WORLDWIDE")) return "Worldwide";
  const shown = openTo.slice(0, 4).map((t) => t.replace("_", " "));
  return shown.join(", ") + (openTo.length > 4 ? ` +${openTo.length - 4}` : "");
}
