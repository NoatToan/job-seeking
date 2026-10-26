export * from "./sources";

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
  postedAt: string | null;
  firstSeenAt: string;
}

/** Latest crawl result per source. */
export interface SourceStatus {
  source: string;
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  jobsFound: number;
  jobsNew: number;
  total: number;
}
