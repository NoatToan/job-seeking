/** Wire types for the contributor-box API (`python/src/contributor_box`). camelCase, ids as strings. */

export type FeedbackKind = "bug" | "feedback" | "idea";
export type FeedbackStatus = "new" | "under_review" | "approved" | "planned" | "done" | "rejected";
export type NoteVisibility = "internal" | "public";

export const KINDS: readonly FeedbackKind[] = ["bug", "feedback", "idea"];
export const STATUSES: readonly FeedbackStatus[] = [
  "new",
  "under_review",
  "approved",
  "planned",
  "done",
  "rejected",
];
/** Statuses shown on the public board. Mirrors `PUBLIC_STATUSES` on the server (which decides). */
export const PUBLIC_STATUSES: readonly FeedbackStatus[] = ["approved", "planned", "done"];

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the item was reported from. Only the author and admins receive it (`null` otherwise). */
export interface FeedbackContext {
  pageUrl: string | null;
  pageTitle: string | null;
  elementSelector: string | null;
  elementText: string | null;
  region: Region | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  hasScreenshot: boolean;
  /** Admins only. */
  userAgent: string | null;
}

export interface FeedbackNote {
  id: string;
  kind: "note" | "status";
  visibility: NoteVisibility;
  body: string;
  fromStatus: FeedbackStatus | null;
  toStatus: FeedbackStatus | null;
  createdAt: string;
  /** Admins only. */
  authorEmail: string | null;
}

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  adminResponse: string | null;
  voteCount: number;
  voted: boolean;
  isMine: boolean;
  canVote: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
  context: FeedbackContext | null;
  /** Admins only. Anonymous items have no id/email, maybe a self-chosen `name`. */
  author: { id: string | null; email: string | null; name?: string | null; anonymous?: boolean } | null;
  /** Detail responses only. */
  notes?: FeedbackNote[];
}

export interface FeedbackPage {
  items: FeedbackItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FeedbackMeta {
  kinds: FeedbackKind[];
  statuses: FeedbackStatus[];
  publicStatuses: FeedbackStatus[];
  isAdmin: boolean;
}

export interface CreateFeedbackInput {
  kind: FeedbackKind;
  title: string;
  body?: string;
  pageUrl?: string | null;
  pageTitle?: string | null;
  elementSelector?: string | null;
  elementText?: string | null;
  region?: Region | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  /** `data:image/jpeg;base64,...` */
  screenshot?: string | null;
  screenshotWidth?: number | null;
  screenshotHeight?: number | null;
  /** Anonymous submissions only (ignored for signed-in users): free-text display name. */
  authorName?: string | null;
}

export interface ListFeedbackQuery {
  scope?: "board" | "mine" | "all";
  kind?: FeedbackKind;
  status?: FeedbackStatus;
  q?: string;
  sort?: "new" | "top";
  limit?: number;
  offset?: number;
}

export interface AdminPatchInput {
  kind?: FeedbackKind;
  title?: string;
  body?: string;
  status?: FeedbackStatus;
  /** `null` clears the public reply. */
  adminResponse?: string | null;
}
