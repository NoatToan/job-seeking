import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock, openLoginMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  openLoginMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/lib/login-modal", () => ({
  useLoginGate: () => ({ openLogin: openLoginMock, requireLogin: vi.fn() }),
}));

import { FeedbackWidget } from "@contributor-box/react";
import { ContributorRoot } from "@/lib/contributor";
import { isPublicRoute } from "@/lib/public-routes";
import sitemap from "@/app/sitemap";
import { RoadmapPage } from "./roadmap-page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const planned = {
  id: "7",
  kind: "idea",
  title: "Salary filter in VND",
  body: "",
  status: "planned",
  adminResponse: "Next sprint",
  score: 4,
  upvotes: 4,
  downvotes: 0,
  myVote: 0,
  commentCount: 2,
  commentsLocked: false,
  byline: {
    kind: "guest",
    name: null,
    pseudonym: { en: "Brave Otter", vi: "Rái cá dũng cảm" },
    tag: "123",
    avatar: { glyph: "O", tone: 1 },
    team: false,
  },
  isMine: false,
  canVote: false,
  canDelete: false,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  statusChangedAt: "2026-11-02T10:00:00Z",
  context: null,
  author: null,
};

describe("Roadmap page", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/feedback/stats")) {
          return Promise.resolve(
            jsonResponse(200, { counts: { new: 0, under_review: 0, approved: 0, planned: 1, done: 0 }, total: 1 }),
          );
        }
        if (url.startsWith("/api/feedback?")) {
          const items = url.includes("status=planned") ? [planned] : [];
          return Promise.resolve(jsonResponse(200, { items, total: items.length, limit: 20, offset: 0 }));
        }
        return Promise.resolve(jsonResponse(404, { error: { code: "not_found", message: "" } }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows the public board to a signed-out visitor, with a sign-in hint instead of voting", async () => {
    render(
      <ContributorRoot>
        <RoadmapPage />
        <FeedbackWidget />
      </ContributorRoot>,
    );
    expect(await screen.findByText("Salary filter in VND")).toBeTruthy();
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(urls).toContain("/api/feedback?scope=board&status=planned&sort=top&limit=20&offset=0");
    // New and under-review feedback is public too (only `rejected` is hidden).
    expect(urls).toContain("/api/feedback?scope=board&status=new&sort=top&limit=20&offset=0");
    expect(urls).toContain("/api/feedback?scope=board&status=under_review&sort=top&limit=20&offset=0");
    expect(screen.getByRole("heading", { name: "New" })).toBeTruthy();
    expect(screen.getByText("2 comments")).toBeTruthy();
    expect(screen.getByText("Brave Otter")).toBeTruthy();
    expect(urls).toContain("/api/feedback/stats");
    expect(await screen.findByText("1 item on the roadmap")).toBeTruthy();
    // Signed out, the arrows stay and open the login modal in place (then cast the vote).
    const up = screen.getByRole("button", { name: "Upvote: Salary filter in VND" });
    expect(up.getAttribute("title")).toBe("Sign in to vote");
    fireEvent.click(up);
    expect(openLoginMock).toHaveBeenCalledWith({
      reason: "Sign in to vote, and to comment and follow your feedback under your own name.",
      onSignedIn: expect.any(Function),
    });
    expect(screen.queryByRole("link", { name: /Sign in to vote/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Contribute" })).toBeNull();

    // "Suggest an idea" opens the feedback widget as a guest, with "Feature idea" selected.
    fireEvent.click(screen.getByRole("button", { name: "Suggest an idea" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByLabelText("Feature idea")).toHaveProperty("checked", true);
  });

  it("is a public, indexed route", () => {
    expect(isPublicRoute("/roadmap/")).toBe(true);
    expect(sitemap().map((e) => e.url)).toContainEqual(expect.stringMatching(/\/roadmap\/$/));
  });
});
