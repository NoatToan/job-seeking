import type {
  AdminPatchInput,
  CommentPage,
  CreateCommentInput,
  CreateFeedbackInput,
  DeleteCommentResult,
  FeedbackComment,
  FeedbackIdentity,
  FeedbackItem,
  FeedbackMeta,
  FeedbackNote,
  FeedbackPage,
  FeedbackStats,
  ListFeedbackQuery,
  NoteVisibility,
  RepliesPage,
  ReportedCommentPage,
  VoteValue,
} from "./types";

/**
 * The transport the host provides: performs the request with its own cookies/CSRF handling,
 * JSON-encodes plain-object bodies, parses JSON, throws on non-2xx (e.g. job-seeking's `apiFetch`).
 */
export type Request = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface FeedbackApi {
  meta(): Promise<FeedbackMeta>;
  list(query?: ListFeedbackQuery): Promise<FeedbackPage>;
  /** Items per public status. Works signed out when the server has `public_board=True`. */
  stats(): Promise<FeedbackStats>;
  get(id: string): Promise<FeedbackItem>;
  create(input: CreateFeedbackInput): Promise<FeedbackItem>;
  /** +1 / -1 sets the viewer's vote (switching is fine), 0 removes it. */
  vote(id: string, value: VoteValue): Promise<FeedbackItem>;
  update(id: string, patch: AdminPatchInput): Promise<FeedbackItem>;
  addNote(id: string, body: string, visibility: NoteVisibility): Promise<FeedbackNote>;
  deleteNote(id: string, noteId: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** URL for `<img src>`; same origin as the API so it passes a `img-src 'self'` CSP. */
  screenshotUrl(id: string): string;
  // Comments
  comments(id: string, query?: PageQuery): Promise<CommentPage>;
  replies(id: string, commentId: string, query?: PageQuery): Promise<RepliesPage>;
  addComment(id: string, input: CreateCommentInput): Promise<FeedbackComment>;
  editComment(id: string, commentId: string, body: string): Promise<FeedbackComment>;
  deleteComment(id: string, commentId: string): Promise<DeleteCommentResult>;
  voteComment(id: string, commentId: string, value: VoteValue): Promise<FeedbackComment>;
  reportComment(id: string, commentId: string, reason?: string | null): Promise<void>;
  /** Admins. */
  setCommentHidden(id: string, commentId: string, hidden: boolean): Promise<FeedbackComment>;
  /** Admins. */
  reportedComments(query?: PageQuery): Promise<ReportedCommentPage>;
  /** Admins. */
  dismissReports(id: string, commentId: string): Promise<void>;
  // Identity
  /** Who the viewer appears as. Signed out, this also issues the visitor cookie. */
  identity(): Promise<FeedbackIdentity>;
  /** Sets (or with `null` clears) the viewer's display name. */
  setDisplayName(name: string | null): Promise<FeedbackIdentity>;
}

export interface FeedbackApiOptions {
  /** API path prefix. Default `/api/feedback`. */
  prefix?: string;
  /** Origin prepended to `screenshotUrl` (e.g. the host's API base URL). Default "" (same origin). */
  baseUrl?: string;
}

function query(params: object): string {
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
  const item = (itemId: string) => `${prefix}/${id(itemId)}`;
  const comment = (itemId: string, commentId: string) => `${item(itemId)}/comments/${id(commentId)}`;
  return {
    meta: () => request<FeedbackMeta>(`${prefix}/meta`),
    list: (q = {}) => request<FeedbackPage>(`${prefix}${query(q)}`),
    stats: () => request<FeedbackStats>(`${prefix}/stats`),
    get: (itemId) => request<FeedbackItem>(item(itemId)),
    create: (input) => request<FeedbackItem>(prefix, { method: "POST", body: input }),
    vote: (itemId, value) =>
      value === 0
        ? request<FeedbackItem>(`${item(itemId)}/vote`, { method: "DELETE" })
        : request<FeedbackItem>(`${item(itemId)}/vote`, { method: "PUT", body: { value } }),
    update: (itemId, patch) => request<FeedbackItem>(item(itemId), { method: "PATCH", body: patch }),
    addNote: (itemId, body, visibility) =>
      request<FeedbackNote>(`${item(itemId)}/notes`, { method: "POST", body: { body, visibility } }),
    deleteNote: (itemId, noteId) =>
      request<void>(`${item(itemId)}/notes/${id(noteId)}`, { method: "DELETE" }),
    remove: (itemId) => request<void>(item(itemId), { method: "DELETE" }),
    screenshotUrl: (itemId) => `${baseUrl}${item(itemId)}/screenshot`,
    comments: (itemId, q = {}) => request<CommentPage>(`${item(itemId)}/comments${query(q)}`),
    replies: (itemId, commentId, q = {}) =>
      request<RepliesPage>(`${comment(itemId, commentId)}/replies${query(q)}`),
    addComment: (itemId, input) =>
      request<FeedbackComment>(`${item(itemId)}/comments`, { method: "POST", body: input }),
    editComment: (itemId, commentId, body) =>
      request<FeedbackComment>(comment(itemId, commentId), { method: "PATCH", body: { body } }),
    deleteComment: (itemId, commentId) =>
      request<DeleteCommentResult>(comment(itemId, commentId), { method: "DELETE" }),
    voteComment: (itemId, commentId, value) =>
      value === 0
        ? request<FeedbackComment>(`${comment(itemId, commentId)}/vote`, { method: "DELETE" })
        : request<FeedbackComment>(`${comment(itemId, commentId)}/vote`, { method: "PUT", body: { value } }),
    reportComment: async (itemId, commentId, reason) => {
      await request<unknown>(`${comment(itemId, commentId)}/report`, {
        method: "POST",
        body: reason ? { reason } : {},
      });
    },
    setCommentHidden: (itemId, commentId, hidden) =>
      request<FeedbackComment>(`${comment(itemId, commentId)}/hidden`, { method: hidden ? "PUT" : "DELETE" }),
    reportedComments: (q = {}) => request<ReportedCommentPage>(`${prefix}/comments/reported${query(q)}`),
    dismissReports: (itemId, commentId) =>
      request<void>(`${comment(itemId, commentId)}/reports`, { method: "DELETE" }),
    identity: () => request<FeedbackIdentity>(`${prefix}/identity`),
    setDisplayName: (name) =>
      request<FeedbackIdentity>(`${prefix}/identity`, { method: "PUT", body: { displayName: name } }),
  };
}
