import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
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
  voteCount: 4,
  voted: false,
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
          return Promise.resolve(jsonResponse(200, { counts: { approved: 0, planned: 1, done: 0 }, total: 1 }));
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
    expect(urls).toContain("/api/feedback/stats");
    expect(await screen.findByText("1 item on the roadmap")).toBeTruthy();
    const hint = screen.getByRole("link", { name: "Sign in to vote (4 votes)" });
    expect(hint.getAttribute("href")).toMatch(/^\/login\/?\?next=/);
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
