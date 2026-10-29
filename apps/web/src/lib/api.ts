import type { ApiErrorBody, Job, JobDetail, Page, SourceInfo } from "@ujc/core";

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
