import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { ContributorRoot } from "@/lib/contributor";
import { AdminFeedbackPage } from "@/app/admin/feedback/admin-feedback-page";
import { ContributePage } from "./contribute-page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function session(role: "user" | "admin") {
  return {
    me: {
      user: { id: "1", email: "person@example.com", aiConsentAt: null, onboardedAt: null, role },
      preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
      latestCv: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

const idea = {
  id: "7",
  kind: "idea",
  title: "Salary filter in VND",
  body: "",
  status: "planned",
  adminResponse: null,
  voteCount: 4,
  voted: false,
  isMine: false,
  canVote: true,
  canDelete: false,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  statusChangedAt: null,
  context: null,
  author: null,
};

describe("Contributor pages", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/feedback/meta")) {
          return Promise.resolve(jsonResponse(200, { kinds: [], statuses: [], publicStatuses: [], isAdmin: false }));
        }
        if (url.startsWith("/api/feedback?")) {
          return Promise.resolve(jsonResponse(200, { items: [idea], total: 1, limit: 20, offset: 0 }));
        }
        return Promise.resolve(jsonResponse(404, { error: { code: "not_found", message: "" } }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows the ideas board from /api/feedback, and no admin link for a plain user", async () => {
    useSessionMock.mockReturnValue(session("user"));
    render(
      <ContributorRoot>
        <ContributePage />
      </ContributorRoot>,
    );
    expect(await screen.findByText("Salary filter in VND")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/feedback?scope=board&sort=top&limit=20&offset=0");
    expect(screen.queryByRole("link", { name: "Review feedback" })).toBeNull();
  });

  it("links admins to the review screen", async () => {
    useSessionMock.mockReturnValue(session("admin"));
    render(
      <ContributorRoot>
        <ContributePage />
      </ContributorRoot>,
    );
    expect((await screen.findByRole("link", { name: "Review feedback" })).getAttribute("href")).toMatch(/^\/admin\/feedback\/?$/);
  });

  it("the admin page defers to the API: a non-admin sees the notice and no queue", async () => {
    useSessionMock.mockReturnValue(session("admin"));
    render(
      <ContributorRoot>
        <AdminFeedbackPage />
      </ContributorRoot>,
    );
    expect(await screen.findByText("This page is for admins.")).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes("scope=all"))).toBe(false),
    );
  });
});
