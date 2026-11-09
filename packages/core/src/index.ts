export * from "./sources";
export * from "./api";
export * from "./tech";
export * from "./remote";
export * from "./jd";
import { COUNTRY_REGIONS, WORLDWIDE } from "./remote";
import type { JobLevel } from "./jd";

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
  /** Time zone(s) the job works in: IANA names ("America/New_York") or fixed offsets
   * ("UTC-05:00"); several = any of them, first is the primary. null/absent = unknown
   * (job_crawler.timezones). */
  timezones?: string[] | null;
  /** "stated" = the posting says it; "location" = inferred from where the job is. */
  timezoneSource?: "stated" | "location" | null;
  /** Structured salary (job_crawler.salary): amounts in `currency` per `period`. `source` =
   * "source" (the board sent it) or "description" (found in the posting text). */
  salary?: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: "year" | "month" | "week" | "day" | "hour" | null;
    source: "source" | "description";
  } | null;
  /** Tech ids found in the posting (job_crawler.techstack), e.g. ["nextjs", "react"]. */
  techStack?: string[];
  /** Seniority (job_crawler.level); null/absent = not stated. */
  level?: JobLevel | null;
  /** Where `level` came from: the board's own field, the title, or the description text. */
  levelSource?: "source" | "title" | "description" | null;
  /** Relocation (job_crawler.relocation): `support` = the employer helps you move (false = the
   * posting says it doesn't), `required` = you must live there or move there (false = "no
   * relocation required"); null = not stated. Absent on payloads that predate it. */
  relocation?: { support: boolean | null; required: boolean | null } | null;
  /** Company logo URL (job_crawler.logo): the source's logo or the employer's site icon.
   * null/absent = unknown, the apps show the company's initials. */
  companyLogo?: string | null;
  /** Claude's fit score for the profile's latest CV (job_crawler.matching), if scored */
  match?: { score: number; summary: string; missingSkills: string[] } | null;
  /** What other job seekers say about this posting (apps/api ujc_api/job_votes.py); null/absent =
   * no counted votes. The same for every viewer: the viewer's own vote is `GET /api/me/job-votes`. */
  community?: JobCommunity | null;
}

/** Why a job isn't worth applying to (a "Not worth applying?" report). */
export const JOB_VOTE_REASONS = [
  "expired",
  "not_remote",
  "scam",
  "wrong_details",
  "ghosting",
  "evergreen",
  "other",
] as const;
export type JobVoteReason = (typeof JOB_VOTE_REASONS)[number];

/** Longest note on a report (reason "other"). */
export const JOB_VOTE_NOTE_MAX = 200;

/** Aggregate community signal on a job (`job_vote_stats`). Counts only votes that count: accounts
 * older than a day, reports from the last 45 days, none older than an admin clear or a repost. */
export interface JobCommunity {
  /** "Not worth applying" reports. */
  reports: number;
  /** "Still good" confirmations. */
  confirms: number;
  /** Enough recent reports (weighted) and more than the confirmations: warn on the job row. */
  flagged: boolean;
  topReason: JobVoteReason | null;
  /** Reports per reason. */
  reasons: Partial<Record<JobVoteReason, number>>;
  lastReportedAt: string | null;
}

/** The signed-in user's own vote on a job. */
export interface MyJobVote {
  vote: "up" | "down";
  reason: JobVoteReason | null;
  /** Private note (reason "other"); only the voter and admins see it. */
  note: string | null;
  updatedAt: string;
  /** Whether it counts in `community` right now (false for accounts under a day old, or after an
   * admin cleared the job's reports). */
  counted: boolean;
}

/**
 * Candidate locations for "I'm based in". `accepts` lists the open_to tokens (see
 * apps/crawler eligibility.py) that make a remote job open to someone living there.
 */
const CANDIDATE_LABELS: [string, string][] = [
  ["VN", "Vietnam"], ["TH", "Thailand"], ["MY", "Malaysia"], ["SG", "Singapore"], ["ID", "Indonesia"],
  ["PH", "Philippines"], ["IN", "India"], ["JP", "Japan"], ["KR", "South Korea"], ["AU", "Australia"],
  ["NZ", "New Zealand"], ["GB", "United Kingdom"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"],
  ["ES", "Spain"], ["PL", "Poland"], ["US", "United States"], ["CA", "Canada"], ["MX", "Mexico"],
  ["BR", "Brazil"], ["AR", "Argentina"],
];
export const CANDIDATE_COUNTRIES: { code: string; label: string; accepts: string[] }[] = CANDIDATE_LABELS.map(
  ([code, label]) => ({ code, label, accepts: [WORLDWIDE, code, ...(COUNTRY_REGIONS[code] ?? [])] }),
);

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
