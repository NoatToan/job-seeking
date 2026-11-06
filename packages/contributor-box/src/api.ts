import type {
  AdminPatchInput,
  CreateFeedbackInput,
  FeedbackItem,
  FeedbackMeta,
  FeedbackNote,
  FeedbackPage,
  ListFeedbackQuery,
  NoteVisibility,
} from "./types";

/**
 * The transport the host provides: performs the request with its own cookies/CSRF handling,
 * JSON-encodes plain-object bodies, parses JSON, throws on non-2xx (e.g. job-seeking's `apiFetch`).
 */
export type Request = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export interface FeedbackApi {
  meta(): Promise<FeedbackMeta>;
  list(query?: ListFeedbackQuery): Promise<FeedbackPage>;
  get(id: string): Promise<FeedbackItem>;
  create(input: CreateFeedbackInput): Promise<FeedbackItem>;
  vote(id: string, on: boolean): Promise<FeedbackItem>;
  update(id: string, patch: AdminPatchInput): Promise<FeedbackItem>;
  addNote(id: string, body: string, visibility: NoteVisibility): Promise<FeedbackNote>;
  deleteNote(id: string, noteId: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** URL for `<img src>`; same origin as the API so it passes a `img-src 'self'` CSP. */
  screenshotUrl(id: string): string;
}

export interface FeedbackApiOptions {
  /** API path prefix. Default `/api/feedback`. */
  prefix?: string;
  /** Origin prepended to `screenshotUrl` (e.g. the host's API base URL). Default "" (same origin). */
  baseUrl?: string;
}

function query(params: ListFeedbackQuery): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const id = (value: string) => encodeURIComponent(value);

export function createFeedbackApi(request: Request, options: FeedbackApiOptions = {}): FeedbackApi {
  const prefix = options.prefix ?? "/api/feedback";
  const baseUrl = options.baseUrl ?? "";
  return {
    meta: () => request<FeedbackMeta>(`${prefix}/meta`),
    list: (q = {}) => request<FeedbackPage>(`${prefix}${query(q)}`),
    get: (itemId) => request<FeedbackItem>(`${prefix}/${id(itemId)}`),
    create: (input) => request<FeedbackItem>(prefix, { method: "POST", body: input }),
    vote: (itemId, on) =>
      request<FeedbackItem>(`${prefix}/${id(itemId)}/vote`, { method: on ? "PUT" : "DELETE" }),
    update: (itemId, patch) =>
      request<FeedbackItem>(`${prefix}/${id(itemId)}`, { method: "PATCH", body: patch }),
    addNote: (itemId, body, visibility) =>
      request<FeedbackNote>(`${prefix}/${id(itemId)}/notes`, {
        method: "POST",
        body: { body, visibility },
      }),
    deleteNote: (itemId, noteId) =>
      request<void>(`${prefix}/${id(itemId)}/notes/${id(noteId)}`, { method: "DELETE" }),
    remove: (itemId) => request<void>(`${prefix}/${id(itemId)}`, { method: "DELETE" }),
    screenshotUrl: (itemId) => `${baseUrl}${prefix}/${id(itemId)}/screenshot`,
  };
}
