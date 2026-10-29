import type {
  ApiErrorBody,
  Cv,
  FeedPage,
  Job,
  JobDetail,
  LiveSearchPage,
  MeResponse,
  Page,
  Preferences,
  SourceInfo,
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
}

/** `GET /api/feed` — jobs matching the user's keywords, newest first, keyset-paginated. */
export function getFeed(filters: FeedFilters = {}): Promise<FeedPage> {
  return apiFetch<FeedPage>(`/api/feed${buildQuery(filters)}`);
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
