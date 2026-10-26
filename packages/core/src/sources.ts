// Every place a job can come from. The id is stored in jobs.source and crawl_runs.source,
// and must match the Python crawler (apps/crawler/src/job_crawler/sources).
export const SOURCES = {
  weworkremotely: { label: "We Work Remotely", homepage: "https://weworkremotely.com", color: "#1f6feb", kind: "feed" },
  greenhouse: { label: "Greenhouse", homepage: "https://www.greenhouse.com", color: "#24a148", kind: "ats" },
  lever: { label: "Lever", homepage: "https://www.lever.co", color: "#6b46c1", kind: "ats" },
  ashby: { label: "Ashby", homepage: "https://www.ashbyhq.com", color: "#d97706", kind: "ats" },
  himalayas: { label: "Himalayas", homepage: "https://himalayas.app", color: "#0e7490", kind: "feed" },
  adzuna: { label: "Adzuna", homepage: "https://www.adzuna.com", color: "#be123c", kind: "api" },
  linkedin: { label: "LinkedIn", homepage: "https://www.linkedin.com", color: "#0a66c2", kind: "session" },
  seek: { label: "Seek", homepage: "https://www.seek.com.au", color: "#e60278", kind: "session" },
} as const satisfies Record<string, SourceMeta>;

export type SourceId = keyof typeof SOURCES;

export interface SourceMeta {
  label: string;
  homepage: string;
  color: string;
  /**
   * feed = public RSS/API, ats = company board on a public ATS API, api = licensed aggregator API,
   * session = crawled in the user's own logged-in browser (apps/crawler job_crawler.session)
   */
  kind: "feed" | "ats" | "api" | "session";
}

export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

export function isSourceId(value: string): value is SourceId {
  return value in SOURCES;
}

export function sourceMeta(id: string): SourceMeta {
  return isSourceId(id) ? SOURCES[id] : { label: id, homepage: "", color: "#6b7280", kind: "feed" };
}

// Deep links to each site's own search for the same keywords.
export const DEEP_LINK_SITES = [
  { label: "LinkedIn", search: (q: string) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q)}` },
  { label: "Seek", search: (q: string) => `https://www.seek.com.au/jobs?keywords=${encodeURIComponent(q)}` },
  { label: "Glassdoor", search: (q: string) => `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}` },
  { label: "Arc", search: (q: string) => `https://arc.dev/remote-jobs?search=${encodeURIComponent(q)}` },
  { label: "YC Work at a Startup", search: (q: string) => `https://www.workatastartup.com/jobs?query=${encodeURIComponent(q)}` },
] as const;
