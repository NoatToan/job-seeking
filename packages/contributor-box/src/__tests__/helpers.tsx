import { vi } from "vitest";
import type { ReactNode } from "react";
import type { FeedbackApi } from "../api";
import { ContributorProvider } from "../context";
import type { FeedbackItem } from "../types";

export function makeItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "1",
    kind: "idea",
    title: "Dark mode",
    body: "Please",
    status: "approved",
    adminResponse: null,
    voteCount: 2,
    voted: false,
    isMine: false,
    canVote: true,
    canDelete: false,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    statusChangedAt: null,
    context: null,
    author: null,
    notes: [],
    ...overrides,
  };
}

export function fakeApi(overrides: Partial<FeedbackApi> = {}): FeedbackApi {
  return {
    meta: vi.fn(async () => ({ kinds: [], statuses: [], publicStatuses: [], isAdmin: false })),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    stats: vi.fn(async () => ({ counts: { approved: 0, planned: 0, done: 0 }, total: 0 })),
    get: vi.fn(async (id: string) => makeItem({ id })),
    create: vi.fn(async () => makeItem({ status: "new", isMine: true })),
    vote: vi.fn(async (id: string, on: boolean) => makeItem({ id, voted: on, voteCount: on ? 3 : 2 })),
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
    ...overrides,
  };
}

export function wrap(api: FeedbackApi, signedIn = true, allowAnonymous = false) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ContributorProvider
        api={api}
        signedIn={signedIn}
        allowAnonymous={allowAnonymous}
        signInHref="/login/"
        boardHref="/contribute/"
      >
        {children}
      </ContributorProvider>
    );
  };
}
