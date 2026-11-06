import { vi } from "vitest";
import type { ReactNode } from "react";
import type { FeedbackApi } from "../api";
import { ContributorProvider } from "../context";
import { strings, type ContributorStrings } from "../strings";
import type { FeedbackComment, FeedbackIdentity, FeedbackItem, PublicAuthor, VoteValue } from "../types";

export const GUEST: PublicAuthor = {
  kind: "guest",
  name: null,
  pseudonym: { en: "Brave Otter", vi: "Rái cá dũng cảm" },
  tag: "123",
  avatar: { glyph: "🦦", tone: 1 },
  team: false,
};

export const JANE: PublicAuthor = {
  kind: "user",
  name: "jane",
  pseudonym: null,
  tag: null,
  avatar: { glyph: "J", tone: 2 },
  team: false,
};

export function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "1",
    kind: "idea",
    title: "Dark mode",
    body: "Please",
    status: "approved",
    adminResponse: null,
    score: 2,
    upvotes: 2,
    downvotes: 0,
    myVote: 0,
    commentCount: 0,
    commentsLocked: false,
    isMine: false,
    canVote: true,
    canDelete: false,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    statusChangedAt: null,
    byline: JANE,
    context: null,
    author: null,
    notes: [],
    ...overrides,
  };
}

export function makeComment(overrides: Partial<FeedbackComment> = {}): FeedbackComment {
  return {
    id: "c1",
    parentId: null,
    body: "Great idea",
    deleted: false,
    hidden: false,
    author: JANE,
    createdAt: "2026-11-01T10:00:00Z",
    editedAt: null,
    score: 0,
    upvotes: 0,
    downvotes: 0,
    myVote: 0,
    isMine: false,
    canEdit: false,
    canDelete: false,
    canVote: true,
    canReply: true,
    canReport: true,
    canModerate: false,
    reportCount: null,
    replyCount: 0,
    replies: [],
    ...overrides,
  };
}

export function makeIdentity(overrides: Partial<FeedbackIdentity> = {}): FeedbackIdentity {
  return { ...GUEST, customName: null, ...overrides };
}

const scored = (value: VoteValue) => ({ score: 2 + value, upvotes: value === 1 ? 3 : 2, myVote: value });

export function fakeApi(overrides: Partial<FeedbackApi> = {}): FeedbackApi {
  return {
    meta: vi.fn(async () => ({ kinds: [], statuses: [], publicStatuses: [], isAdmin: false })),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    stats: vi.fn(async () => ({
      counts: { new: 0, under_review: 0, approved: 0, planned: 0, done: 0 },
      total: 0,
    })),
    get: vi.fn(async (id: string) => makeItem({ id })),
    create: vi.fn(async () => makeItem({ status: "new", isMine: true })),
    vote: vi.fn(async (id: string, value: VoteValue) => makeItem({ id, ...scored(value) })),
    update: vi.fn(async (id: string) => makeItem({ id })),
    addNote: vi.fn(async () => ({
      id: "n1",
      kind: "note" as const,
      visibility: "internal" as const,
      body: "x",
      fromStatus: null,
      toStatus: null,
      createdAt: "2026-11-01T10:00:00Z",
      authorEmail: null,
    })),
    deleteNote: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    screenshotUrl: (id: string) => `/api/feedback/${id}/screenshot`,
    comments: vi.fn(async () => ({ comments: [], total: 0, limit: 20, offset: 0, locked: false, canComment: true })),
    replies: vi.fn(async () => ({ replies: [], total: 0, limit: 50, offset: 0 })),
    addComment: vi.fn(async (_id: string, input) =>
      makeComment({ id: "new", body: input.body, parentId: input.parentId ?? null, isMine: true, canEdit: true }),
    ),
    editComment: vi.fn(async (_id: string, commentId: string, body: string) =>
      makeComment({ id: commentId, body, editedAt: "2026-11-01T10:05:00Z", isMine: true, canEdit: true, canDelete: true }),
    ),
    deleteComment: vi.fn(async () => ({ result: "hard" as const, comment: null })),
    voteComment: vi.fn(async (_id: string, commentId: string, value: VoteValue) =>
      makeComment({ id: commentId, score: value, myVote: value }),
    ),
    reportComment: vi.fn(async () => undefined),
    setCommentHidden: vi.fn(async (_id: string, commentId: string, hidden: boolean) =>
      makeComment({ id: commentId, hidden, canModerate: true }),
    ),
    reportedComments: vi.fn(async () => ({ comments: [], total: 0, limit: 20, offset: 0 })),
    dismissReports: vi.fn(async () => undefined),
    identity: vi.fn(async () => makeIdentity()),
    setDisplayName: vi.fn(async (name: string | null) => makeIdentity({ name, customName: name })),
    ...overrides,
  };
}

export function wrap(
  api: FeedbackApi,
  signedIn = true,
  allowAnonymous = false,
  s: ContributorStrings = strings.en,
  onRequireSignIn?: (resume?: () => void) => void,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ContributorProvider
        api={api}
        signedIn={signedIn}
        allowAnonymous={allowAnonymous}
        onRequireSignIn={onRequireSignIn}
        signInHref="/login/"
        boardHref="/contribute/"
        roadmapHref="/roadmap/"
        strings={s}
      >
        {children}
      </ContributorProvider>
    );
  };
}
