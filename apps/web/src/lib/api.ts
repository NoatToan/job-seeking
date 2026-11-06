import type {
  AdzunaConnection,
  ApiErrorBody,
  Application,
  ApplicationEvent,
  ApplicationStatus,
  CreatedPersonalAccessToken,
  Cv,
  FeedPage,
  Job,
  JobDetail,
  LiveSearchPage,
  MeResponse,
  Page,
  PersonalAccessToken,
  Platform,
  Preferences,
  JobFacets,
  PublicJobsPage,
  Runner,
  RunnerPairingCode,
  SourceInfo,
  TokenScope,
  UpworkSearchPage,
} from "@ujc/core";

/**
 * Base URL the SPA calls for the API. "" (default) means same origin, so calls go to
 * `/api/...` (production, proxied by Caddy). In dev it is `http://localhost:8000`.
 * See docs/product/ARCHITECTURE.md §3.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Thrown by `apiFetch` for any non-2xx response, mapped from the `{error:{...}}` body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registers the callback `apiFetch` invokes whenever a request resolves with 401
 * (e.g. redirect to `/login?next=...`). Pass `null` to clear it.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** Plain object bodies are JSON-encoded; `FormData` is sent as-is. */
  body?: unknown;
}

/**
 * Typed fetch wrapper for the `/api` backend. Sends cookies (`credentials: 'include'`), adds
 * `X-CSRF-Token` from the `ujc_csrf` cookie on unsafe methods, parses JSON, and maps error
 * bodies to `ApiError`. A 401 response invokes the registered unauthorized handler, if any.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { body: rawBody, headers: initHeaders, ...rest } = init;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(initHeaders);
  let body: BodyInit | undefined;

  if (rawBody instanceof FormData) {
    body = rawBody;
  } else if (rawBody !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(rawBody);
  }

  if (UNSAFE_METHODS.has(method)) {
    const csrf = readCookie("ujc_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    method,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 401) unauthorizedHandler?.();

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const errBody = data as ApiErrorBody | undefined;
    throw new ApiError(
      res.status,
      errBody?.error?.code ?? "unknown_error",
      errBody?.error?.message ?? res.statusText,
      errBody?.error?.fields,
    );
  }

  return data as T;
}

function buildQuery(params: object): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value === undefined || value === "" || value === false) continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface JobFilters {
  q?: string;
  source?: string;
  remote?: boolean;
  page?: number;
}

/** `GET /api/jobs` — browse the public catalogue (+ own jobs if signed in). */
export function getJobs(filters: JobFilters = {}): Promise<Page<Job>> {
  return apiFetch<Page<Job>>(`/api/jobs${buildQuery(filters)}`);
}

/** `GET /api/jobs/{id}` — job detail including description; 404 if not visible. */
export function getJob(id: string): Promise<JobDetail> {
  return apiFetch<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`);
}

/** `GET /api/sources` — source catalogue + latest global crawl run per source. */
export function getSources(): Promise<SourceInfo[]> {
  return apiFetch<SourceInfo[]>("/api/sources");
}

export interface PublicJobsFilters {
  cursor?: string;
  limit?: number;
  q?: string;
  source?: string;
  remote?: boolean;
  /** ISO country code: jobs in / open to that country (`jobs.countries`). */
  country?: string;
  /** Comma-separated tech ids: jobs mentioning all of them (`jobs.tech_stack`). */
  tech?: string;
  /** Only jobs posted (or first seen) within this many days. */
  days?: number;
}

/** `GET /api/jobs` — the public job catalogue, newest first, keyset-paginated. No sign-in
 * required: this is what `/` shows a signed-out visitor instead of their personalised `Feed`. */
export function getPublicJobs(filters: PublicJobsFilters = {}): Promise<PublicJobsPage> {
  return apiFetch<PublicJobsPage>(`/api/jobs${buildQuery(filters)}`);
}

/** `GET /api/me/viewed` — ids of the jobs the signed-in user has read, newest first. */
export function getViewedJobs(): Promise<{ jobIds: string[] }> {
  return apiFetch<{ jobIds: string[] }>("/api/me/viewed");
}

/** `POST /api/me/viewed` — record jobs as read (at most 500 ids per call). */
export function markJobsViewed(jobIds: string[]): Promise<{ saved: number }> {
  return apiFetch<{ saved: number }>("/api/me/viewed", { method: "POST", body: { jobIds } });
}

/** `DELETE /api/me/viewed` — forget the account's read history. */
export function clearViewedJobs(): Promise<void> {
  return apiFetch<void>("/api/me/viewed", { method: "DELETE" });
}

/** `GET /api/jobs/facets` — filter options with job counts (countries, most common first). */
export function getJobFacets(): Promise<JobFacets> {
  return apiFetch<JobFacets>("/api/jobs/facets");
}

// --- Flow v2 (docs/product/FLOW_V2.md §4): email OTP, CV upload, feed, live search. -------------

export interface OtpRequestResponse {
  sent: boolean;
  expiresInSec: number;
  /** Only present in review-mode deployments (`UJC_OTP_REVIEW_MODE=true`); never in production. */
  devCode?: string;
}

/** `POST /api/auth/otp` — request a 6-digit sign-in code by email. */
export function requestOtp(email: string): Promise<OtpRequestResponse> {
  return apiFetch<OtpRequestResponse>("/api/auth/otp", { method: "POST", body: { email } });
}

export interface VerifyOtpResponse {
  user: { id: string; email: string };
}

/** `POST /api/auth/verify` — exchange the emailed code for a session cookie. */
export function verifyOtp(email: string, code: string): Promise<VerifyOtpResponse> {
  return apiFetch<VerifyOtpResponse>("/api/auth/verify", { method: "POST", body: { email, code } });
}

/** `POST /api/auth/logout` — clears the session cookie. */
export function logout(): Promise<void> {
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

/** `GET /api/me` — the signed-in user, their preferences and latest CV. */
export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me");
}

/** `PUT /api/me/preferences` — save keywords, remote-only and eligibility country. */
export function updatePreferences(input: Preferences): Promise<{ preferences: Preferences }> {
  return apiFetch<{ preferences: Preferences }>("/api/me/preferences", {
    method: "PUT",
    body: input,
  });
}

/** `POST /api/me/consent` — agree to send CV text to the LLM provider (Claude) for extraction.
 * Required once before the first `uploadCv` call, else it 409s `consent_required`. */
export function giveAiConsent(): Promise<{ aiConsentAt: string }> {
  return apiFetch<{ aiConsentAt: string }>("/api/me/consent", {
    method: "POST",
    body: { aiProcessing: true },
  });
}

/** `POST /api/me/onboarded` — marks the onboarding wizard (`/onboarding/`) as finished, so a
 * later login goes straight to the feed instead of back through onboarding. */
export function markOnboarded(): Promise<{ onboardedAt: string }> {
  return apiFetch<{ onboardedAt: string }>("/api/me/onboarded", { method: "POST" });
}

/** `GET /api/me/export` — downloads the signed-in user's data as a JSON `Blob`. */
export async function exportMyData(): Promise<Blob> {
  const headers = new Headers();
  const csrf = typeof document !== "undefined" ? readCsrfCookie() : null;
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const res = await fetch(`${API_BASE_URL}/api/me/export`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    const data: ApiErrorBody | undefined = text ? JSON.parse(text) : undefined;
    throw new ApiError(
      res.status,
      data?.error?.code ?? "unknown_error",
      data?.error?.message ?? res.statusText,
    );
  }
  return res.blob();
}

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|; )ujc_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `DELETE /api/me` — hard-deletes the account (cascades); clears the session. */
export function deleteMyAccount(): Promise<void> {
  return apiFetch<void>("/api/me", { method: "DELETE", body: { confirm: "DELETE" } });
}

/** `POST /api/cvs` — upload a CV (multipart); the host worker scans it asynchronously. */
export function uploadCv(file: File): Promise<Cv> {
  const form = new FormData();
  form.set("file", file);
  return apiFetch<Cv>("/api/cvs", { method: "POST", body: form });
}

/** `GET /api/cvs` — the signed-in user's CVs (no extracted text/profile in the list view). */
export function listCvs(): Promise<{ items: Cv[] }> {
  return apiFetch<{ items: Cv[] }>("/api/cvs");
}

/** `GET /api/cvs/{id}` — poll this while `status` is `queued`/`processing`. */
export function getCv(id: string): Promise<Cv> {
  return apiFetch<Cv>(`/api/cvs/${encodeURIComponent(id)}`);
}

/** `DELETE /api/cvs/{id}`. */
export function deleteCv(id: string): Promise<void> {
  return apiFetch<void>(`/api/cvs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface FeedFilters {
  cursor?: string;
  limit?: number;
  q?: string;
  source?: string;
  /** `"score"` sorts by CV match score (best matches first) instead of newest-first. */
  sort?: "score";
  /** ISO country code: jobs in / open to that country. */
  country?: string;
  /** Comma-separated tech ids: jobs mentioning all of them. */
  tech?: string;
  /** Only jobs posted (or first seen) within this many days. */
  days?: number;
}

/** `GET /api/feed` — jobs matching the user's keywords, newest first, keyset-paginated. */
export function getFeed(filters: FeedFilters = {}): Promise<FeedPage> {
  return apiFetch<FeedPage>(`/api/feed${buildQuery(filters)}`);
}

/**
 * `POST /api/matches/refresh` — queues a `match_score` task that rescans the user's feed against
 * their latest CV. Rate-limited to 3/day; a 429 `quota_exceeded` means try again tomorrow.
 */
export function refreshMatches(): Promise<{ taskId: string }> {
  return apiFetch<{ taskId: string }>("/api/matches/refresh", { method: "POST" });
}

export interface LiveSearchFilters {
  q: string;
  /** Source ids, e.g. `["seek", "himalayas", "remotive", "wwr", "arc"]`. */
  sources: string[];
  cursor?: string;
}

/** `GET /api/search/live` — queries each platform's own search API right now. */
export function liveSearch(filters: LiveSearchFilters): Promise<LiveSearchPage> {
  const { sources, ...rest } = filters;
  return apiFetch<LiveSearchPage>(
    `/api/search/live${buildQuery({ ...rest, sources: sources.join(",") })}`,
  );
}

// --- Tracker (M4-05/M4-06): applications + status history. ---------------------------------

/** `GET /api/applications` — the signed-in user's tracked applications, newest-updated first. */
export function listApplications(status?: ApplicationStatus): Promise<{ items: Application[] }> {
  return apiFetch<{ items: Application[] }>(`/api/applications${buildQuery({ status })}`);
}

/**
 * `POST /api/applications` — track a job. Idempotent: tracking an already-tracked job returns
 * the existing application (200) instead of erroring.
 */
export function saveApplication(
  jobId: string,
  status?: ApplicationStatus,
  note?: string,
): Promise<Application> {
  return apiFetch<Application>("/api/applications", {
    method: "POST",
    body: { jobId, status, note },
  });
}

export interface ApplicationPatch {
  status?: ApplicationStatus;
  note?: string | null;
  nextActionAt?: string | null;
}

/** `PATCH /api/applications/{id}` — update status, note and/or next action date. */
export function updateApplication(id: string, patch: ApplicationPatch): Promise<Application> {
  return apiFetch<Application>(`/api/applications/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

/** `DELETE /api/applications/{id}`. */
export function deleteApplication(id: string): Promise<void> {
  return apiFetch<void>(`/api/applications/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `GET /api/applications/{id}/events` — the status-change history, newest first. */
export function listApplicationEvents(id: string): Promise<{ items: ApplicationEvent[] }> {
  return apiFetch<{ items: ApplicationEvent[] }>(
    `/api/applications/${encodeURIComponent(id)}/events`,
  );
}

// --- Companion runner (M3-06/M3-07): /account "Local runner" section. ----------------------

/** `POST /api/runners/pairing-code` — a one-time code for `job_crawler.runner pair`. */
export function createRunnerPairingCode(): Promise<RunnerPairingCode> {
  return apiFetch<RunnerPairingCode>("/api/runners/pairing-code", { method: "POST" });
}

/** `GET /api/runners` — the signed-in user's paired companion runners. */
export function listRunners(): Promise<{ items: Runner[] }> {
  return apiFetch<{ items: Runner[] }>("/api/runners");
}

/** `DELETE /api/runners/{id}` — revokes a runner's token immediately. */
export function revokeRunner(id: string): Promise<void> {
  return apiFetch<void>(`/api/runners/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Personal access tokens (M3-08): apps/mcp calls the API on the user's behalf. -------------

/** `GET /api/tokens` — the signed-in user's tokens, newest first; never includes the secret. */
export function listTokens(): Promise<{ items: PersonalAccessToken[] }> {
  return apiFetch<{ items: PersonalAccessToken[] }>("/api/tokens");
}

export interface CreateTokenInput {
  name: string;
  scopes: TokenScope[];
  /** 1-365. Defaults to 365 server-side if omitted. */
  expiresInDays?: number;
}

/** `POST /api/tokens` — the raw `ujc_pat_...` value is only ever in this one response. */
export function createToken(input: CreateTokenInput): Promise<CreatedPersonalAccessToken> {
  return apiFetch<CreatedPersonalAccessToken>("/api/tokens", { method: "POST", body: input });
}

/** `DELETE /api/tokens/{id}` — revokes a token; already-used copies stop working immediately. */
export function revokeToken(id: string): Promise<void> {
  return apiFetch<void>(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Connections (M3-01/M3-02/M3-04): platform catalogue, Adzuna key, Upwork OAuth. -------------

/** `GET /api/platforms` — the connection catalogue for the signed-in user. */
export function getPlatforms(): Promise<{ items: Platform[] }> {
  return apiFetch<{ items: Platform[] }>("/api/platforms");
}

/** `PUT /api/connections/adzuna` — validated by one Adzuna call; stores the key encrypted. */
export function connectAdzuna(appId: string, appKey: string): Promise<AdzunaConnection> {
  return apiFetch<AdzunaConnection>("/api/connections/adzuna", {
    method: "PUT",
    body: { appId, appKey },
  });
}

/** `DELETE /api/connections/{platform}` — disconnect (Upwork: also revokes the token). */
export function disconnectPlatform(platform: string): Promise<void> {
  return apiFetch<void>(`/api/connections/${encodeURIComponent(platform)}`, { method: "DELETE" });
}

/** Full-page navigation (not `fetch`) to the Upwork OAuth authorize redirect — the API sets the
 * OAuth-state cookie and 302s to Upwork, so this cannot go through `apiFetch`. */
export function upworkAuthorizeUrl(): string {
  return `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/api/connections/upwork/authorize`;
}

/** `POST /api/upwork/search` — user-directed live search; 404s `not_enabled` when the flag/keys
 * aren't set. Results are cached <=24h server-side and never merged into `Job`/`jobs`. */
export function searchUpwork(q: string, cursor?: string): Promise<UpworkSearchPage> {
  return apiFetch<UpworkSearchPage>("/api/upwork/search", { method: "POST", body: { q, cursor } });
}
