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

// --- Flow v2 (docs/product/FLOW_V2.md §4): email OTP, CV upload, feed, live search. -------------

/** The structured profile extracted from a CV by the host worker's scan (`Cv.profile`). */
export interface CvProfile {
  headline: string | null;
  seniority: string | null;
  skills: string[];
  summary: string | null;
}

/** The signed-in user's uploaded CV and its scan state (`POST/GET/DELETE /api/cvs*`). */
export interface Cv {
  id: string;
  filename: string;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  keywords: string[];
  profile: CvProfile | null;
  createdAt: string;
  processedAt: string | null;
}

/** The user's search preferences (`GET /api/me`, `PUT /api/me/preferences`). `digestHour` is a
 * local hour (0-23) in `digestTz` (IANA name, e.g. "Asia/Ho_Chi_Minh") — see M4-08. The digest
 * fields are optional here (rather than always present) so existing `PUT` callers that only
 * manage keywords/remoteOnly/candidateCountry don't have to change; the API defaults any that
 * are omitted on write, and always includes all three on `GET /api/me`. */
export interface Preferences {
  keywords: string[];
  remoteOnly: boolean;
  candidateCountry: string | null;
  digestEnabled?: boolean;
  digestHour?: number;
  digestTz?: string;
}

/** `GET /api/me`. `aiConsentAt` is set once the user agrees to send CV text to the LLM
 * provider (`POST /api/me/consent`); `POST /api/cvs` 409s `consent_required` until then.
 * `onboardedAt` is set once the onboarding wizard (`POST /api/me/onboarded`) finishes; a
 * signed-in user with `onboardedAt: null` is sent to `/onboarding/`. */
/** `users.role` (or `UJC_ADMIN_EMAILS`): admins review Contributor feedback (`/admin/feedback/`). */
export type UserRole = "user" | "admin";

export interface MeResponse {
  user: {
    id: string;
    email: string;
    aiConsentAt: string | null;
    onboardedAt: string | null;
    /** Only decides what the SPA shows; every admin endpoint re-checks it server-side. */
    role: UserRole;
  };
  preferences: Preferences;
  latestCv: Cv | null;
}

/** `GET /api/feed`: the user's personalised, keyset-paginated feed. */
export interface FeedPage {
  items: Job[];
  nextCursor: string | null;
  keywords: string[];
}

/** `GET /api/jobs`: the public job catalogue, newest first, keyset-paginated. No sign-in
 * required (the home page shows this to a signed-out visitor instead of the personalised
 * `FeedPage`). `total` is an approximate/cheap count when present, and may be omitted. */
/** `GET /api/jobs/facets`: filter options with how many jobs each one has. */
export interface JobFacets {
  countries: { code: string; count: number }[];
  tech: { id: string; count: number }[];
}

export interface PublicJobsPage {
  items: Job[];
  nextCursor: string | null;
  total?: number;
}

/** Lifecycle of a tracked application (`applications.status`, docs/product/ARCHITECTURE.md). */
export type ApplicationStatus =
  | "saved"
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";

/** A snapshot of the job as it looked when the application was created, so the card survives
 * the source `Job` row being deleted (`applications.job_snapshot`). */
export interface ApplicationJobSnapshot {
  title: string;
  company: string | null;
  url: string;
  source: string;
}

/** A tracked application (`GET/POST /api/applications`, `PATCH/DELETE /api/applications/{id}`). */
export interface Application {
  id: string;
  jobId: string | null;
  job: ApplicationJobSnapshot | null;
  status: ApplicationStatus;
  note: string | null;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One status-change entry (`GET /api/applications/{id}/events`). */
export interface ApplicationEvent {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  createdAt: string;
}

// --- Companion runner (M3-06/M3-07): pairing, list, revoke. --------------------------------

/** `POST /api/runners/pairing-code`: a one-time code for `job_crawler.runner pair`. */
export interface RunnerPairingCode {
  code: string;
  expiresAt: string;
}

/** A paired companion runner (`GET /api/runners`). */
export interface Runner {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

// --- Personal access tokens (M3-08): lets the user's own Claude (apps/mcp) call the API. ------

/** A PAT scope. Subset is enforced both client- and server-side (`POST /api/tokens`). */
export type TokenScope = "jobs:read" | "applications:write";

/** One token (`GET/POST/DELETE /api/tokens`). Never carries the raw secret after creation. */
export interface PersonalAccessToken {
  id: string;
  name: string;
  scopes: TokenScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** `POST /api/tokens` response: the token fields plus the raw secret, shown exactly once. */
export interface CreatedPersonalAccessToken extends PersonalAccessToken {
  token: string;
}

// --- Connections (M3-01/M3-02/M3-04): platform catalogue, Adzuna key, Upwork OAuth. -------------

export type PlatformKind = "public" | "api_key" | "oauth" | "runner";

/** One entry of `GET /api/platforms`: what connecting to this platform means and whether the
 * signed-in user already has. `status` (crawl health) is only present for `kind: "public"`. */
export interface Platform {
  id: string;
  label: string;
  kind: PlatformKind;
  homepage: string;
  description: string;
  available: boolean;
  connected: boolean;
  externalAccount?: string | null;
  status?: "running" | "ok" | "error";
}

/** `PUT /api/connections/adzuna` response: the key is never echoed back, only a masked form. */
export interface AdzunaConnection {
  platform: "adzuna";
  connected: boolean;
  externalAccount: string;
  maskedAppKey: string;
}

/** `POST /api/upwork/search` response: cached <=24h, always separately attributed, never merged
 * into `Job`/`jobs` (docs/product/ARCHITECTURE.md §7). */
export interface UpworkSearchPage {
  items: Record<string, unknown>[];
  nextCursor: string | null;
  fetchedAt: string;
  expiresAt: string;
  attribution: "Upwork";
}

/** One source's result for a page of `GET /api/search/live` (`sources[]`). */
export interface LiveSourceStatus {
  id: string;
  count: number;
  error?: string;
}

/** `GET /api/search/live`: results merged across platforms, with per-source status. */
export interface LiveSearchPage {
  items: Job[];
  nextCursor: string | null;
  sources: LiveSourceStatus[];
}
