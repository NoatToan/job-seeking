/** Wire types for the contributor-box API (`python/src/contributor_box`). camelCase, ids as strings. */

export type FeedbackKind = "bug" | "feedback" | "idea";
export type FeedbackStatus = "new" | "under_review" | "approved" | "planned" | "done" | "rejected";
export type NoteVisibility = "internal" | "public";
/** +1 up, -1 down, 0 no vote. */
export type VoteValue = -1 | 0 | 1;

export const KINDS: readonly FeedbackKind[] = ["bug", "feedback", "idea"];
export const STATUSES: readonly FeedbackStatus[] = [
  "new",
  "under_review",
  "approved",
  "planned",
  "done",
  "rejected",
];
/**
 * Statuses shown on the public board: everything but `rejected` (how admins take an item off the
 * board). Mirrors `PUBLIC_STATUSES` on the server (which decides).
 */
export const PUBLIC_STATUSES: readonly FeedbackStatus[] = ["new", "under_review", "approved", "planned", "done"];
/** Roadmap columns, in order: the public statuses. */
export const ROADMAP_STATUSES = ["new", "under_review", "approved", "planned", "done"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

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

/**
 * How someone appears publicly. Never an email. `name` is a chosen name or a user's email local
 * part; a guest without a chosen name has `name: null` and shows `pseudonym[locale]` ("Brave
 * Otter" / "Rái cá dũng cảm") with its `tag` ("#123"). `avatar.glyph` is an initial or an animal
 * emoji, `avatar.tone` 0–4 picks a theme colour.
 */
export interface PublicAuthor {
  kind: "user" | "guest";
  name: string | null;
  pseudonym: { en: string; vi: string } | null;
  tag: string | null;
  avatar: { glyph: string; tone: number };
  /** An admin wrote it ("Team" badge). */
  team: boolean;
}

/** `GET /identity`: who the viewer appears as. */
export interface FeedbackIdentity extends PublicAuthor {
  /** The chosen display name, if any (`null` = generated / email local part). */
  customName: string | null;
}

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  title: string;
  body: string;
  status: FeedbackStatus;
  adminResponse: string | null;
  /** Upvotes minus downvotes. */
  score: number;
  upvotes: number;
  downvotes: number;
  /** The viewer's vote; always 0 signed out. */
  myVote: VoteValue;
  /** Visible comments (not deleted or hidden). */
  commentCount: number;
  commentsLocked: boolean;
  /** Yours: your account, or (signed out) your visitor cookie. */
  isMine: boolean;
  /** False for a signed-out viewer (voting needs a session). */
  canVote: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
  /** Public author (display name or pseudonym); null for an old anonymous item without a name. */
  byline: PublicAuthor | null;
  context: FeedbackContext | null;
  /** Admins only. Anonymous items have no id/email, maybe a self-chosen `name`. */
  author: { id: string | null; email: string | null; name?: string | null; anonymous?: boolean } | null;
  /** Detail responses only. */
  notes?: FeedbackNote[];
}

export interface FeedbackPage {
  items: FeedbackItem[];
  /** Counted on the first page only; `null` on a page fetched with a cursor. */
  total: number | null;
  limit: number;
  offset: number;
  /** Pass as `cursor` for the next page; `null` when there is none. */
  nextCursor?: string | null;
}

/** `GET /stats`: items per public status (the roadmap columns). */
export interface FeedbackStats {
  counts: Record<RoadmapStatus, number>;
  total: number;
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
  /** Anonymous submissions only (ignored for signed-in users): becomes the visitor's display name. */
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
  /** `nextCursor` of the previous page (keyset pagination); takes precedence over `offset`. */
  cursor?: string;
}

export interface AdminPatchInput {
  kind?: FeedbackKind;
  title?: string;
  body?: string;
  status?: FeedbackStatus;
  /** `null` clears the public reply. */
  adminResponse?: string | null;
  commentsLocked?: boolean;
}

// --- comments ------------------------------------------------------------------------------------

export interface FeedbackComment {
  id: string;
  /** `null` for a top-level comment. */
  parentId: string | null;
  /** `null` for a "[deleted]" or (non-admin) "[removed]" placeholder. */
  body: string | null;
  deleted: boolean;
  /** Hidden by a moderator. Admins still see the body. */
  hidden: boolean;
  author: PublicAuthor | null;
  createdAt: string;
  editedAt: string | null;
  score: number;
  upvotes: number;
  downvotes: number;
  myVote: VoteValue;
  isMine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canVote: boolean;
  canReply: boolean;
  canReport: boolean;
  /** Admin: hide / unhide / dismiss reports. */
  canModerate: boolean;
  /** Admins only (null otherwise). */
  reportCount: number | null;
  /** Top-level comments only. */
  replyCount?: number;
  /** Top-level comments in a thread page: the first replies (oldest first). */
  replies?: FeedbackComment[];
}

export interface CommentPage {
  comments: FeedbackComment[];
  total: number;
  limit: number;
  offset: number;
  locked: boolean;
  canComment: boolean;
}

export interface RepliesPage {
  replies: FeedbackComment[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateCommentInput {
  body: string;
  /** A top-level comment's id, or a reply's (the reply joins the same thread). */
  parentId?: string | null;
  /** Honeypot: always empty from a real form. */
  website?: string;
}

export interface DeleteCommentResult {
  result: "soft" | "hard";
  /** The "[deleted]" placeholder when replies keep it in the thread. */
  comment: FeedbackComment | null;
}

export interface ReportedComment extends FeedbackComment {
  item: { id: string; title: string; status: FeedbackStatus };
  reasons: string[];
  lastReportedAt: string | null;
}

export interface ReportedCommentPage {
  comments: ReportedComment[];
  total: number;
  limit: number;
  offset: number;
}
