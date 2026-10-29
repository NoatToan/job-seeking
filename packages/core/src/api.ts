// DTOs shared between apps/web and the (not yet built) apps/api. Shapes follow
// docs/product/ARCHITECTURE.md §5 (API surface): camelCase bodies, string ids, `{items,total,page,pageSize}`
// list envelopes, and `{error:{code,message,fields?}}` error bodies.
import type { Job } from "./index";

/** A paginated list response, as returned by every `GET` list endpoint. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The JSON body of a non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

/** The signed-in user (`GET /api/auth/me`). */
export interface User {
  id: string;
  email: string;
  displayName: string | null;
  country: string | null;
  timezone: string;
  locale: string;
  emailVerifiedAt: string | null;
  isAdmin: boolean;
  createdAt: string;
}

/** What a user is looking for (`/api/profiles`). */
export interface SearchProfile {
  id: string;
  name: string;
  keywords: string;
  locations: string[];
  remoteOnly: boolean;
  sources: string[];
  candidateCountry: string | null;
  createdAt: string;
}

/** Payload to create or update a search profile. */
export interface ProfileInput {
  name: string;
  keywords: string;
  locations: string[];
  remoteOnly: boolean;
  sources: string[];
  candidateCountry: string | null;
}

/** One entry of `GET /api/sources`: a source's catalogue info + its latest global crawl run. */
export interface SourceInfo {
  source: string;
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  jobsFound: number;
  jobsNew: number;
  total: number;
}

/** `GET /api/tasks/{id}`: progress of a background task. */
export interface TaskStatus {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

/** `GET /api/jobs/{id}`: a job plus its full description. */
export interface JobDetail extends Job {
  description: string | null;
}
