import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Job, JobCommunity, MyJobVote } from "@ujc/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireLoginMock, sessionMock } = vi.hoisted(() => ({
  requireLoginMock: vi.fn((action?: () => void) => action?.()),
  sessionMock: { me: null as null | { user: { role: string } } },
}));
vi.mock("@/lib/login-modal", () => ({ useRequireLogin: () => requireLoginMock }));
vi.mock("@/lib/session", () => ({ useSession: () => sessionMock }));

import { applyVoteDelta, CommunityFlagChip, JobVotePanel } from "./job-vote";

const JOB: Job = {
  id: "42",
  source: "weworkremotely",
  url: "https://example.com/42",
  applyUrl: null,
  title: "Backend Engineer",
  company: "Acme",
  location: null,
  remote: true,
  employmentType: null,
  salaryText: null,
  tags: [],
  openTo: null,
  postedAt: null,
  firstSeenAt: "2026-11-01T00:00:00Z",
};

const FLAGGED: JobCommunity = {
  reports: 3,
  confirms: 1,
  flagged: true,
  topReason: "expired",
  reasons: { expired: 2, ghosting: 1 },
  lastReportedAt: "2026-11-06T00:00:00Z",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const down = (reason: MyJobVote["reason"], counted = true): MyJobVote => ({
  vote: "down",
  reason,
  note: null,
  updatedAt: "2026-11-07T00:00:00Z",
  counted,
});

describe("applyVoteDelta", () => {
  it("moves counts and reasons for a counted vote, and ignores one that doesn't count", () => {
    const after = applyVoteDelta(FLAGGED, null, down("scam"));
    expect(after?.reports).toBe(4);
    expect(after?.reasons).toEqual({ expired: 2, ghosting: 1, scam: 1 });
    const changed = applyVoteDelta(after, down("scam"), { ...down(null), vote: "up" });
    expect(changed).toMatchObject({ reports: 3, confirms: 2, reasons: { expired: 2, ghosting: 1 } });
    expect(applyVoteDelta(null, null, down("scam", false))).toBeNull();
    expect(applyVoteDelta({ ...FLAGGED, reports: 1, confirms: 0, reasons: { scam: 1 } }, down("scam"), null)).toBeNull();
  });
});

describe("CommunityFlagChip", () => {
  afterEach(cleanup);

  it("shows only for flagged jobs, with the count and top reason", () => {
    const { container, rerender } = render(<CommunityFlagChip community={{ ...FLAGGED, flagged: false }} />);
    expect(container.textContent).toBe("");
    rerender(<CommunityFlagChip community={FLAGGED} />);
    expect(screen.getByText("3 reports · Expired")).toBeTruthy();
  });
});

describe("JobVotePanel", () => {
  beforeEach(() => {
    requireLoginMock.mockClear();
    sessionMock.me = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows the community summary to everyone; signed out, voting asks to sign in first", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    requireLoginMock.mockImplementationOnce(() => {});
    render(<JobVotePanel job={{ ...JOB, community: FLAGGED }} signedIn={false} />);

    expect(screen.getByText("3 people say it's not worth applying")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Reported reasons" }).textContent).toContain("Ghosting / no reply");
    fireEvent.click(screen.getByRole("button", { name: "Still good" }));
    expect(requireLoginMock).toHaveBeenCalledWith(expect.any(Function), { reason: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports with a required reason, optimistically, then takes the server's counts", async () => {
    sessionMock.me = { user: { role: "user" } };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/me/job-votes?ids=42") return Promise.resolve(json(200, { votes: {}, community: { "42": null } }));
      if (url === "/api/jobs/42/vote" && method === "PUT") {
        return Promise.resolve(json(200, { vote: down("not_remote"), community: { ...FLAGGED, reports: 1, flagged: false, reasons: { not_remote: 1 } } }));
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      render(<JobVotePanel job={JOB} signedIn />);
    });

    const downButton = screen.getByRole("button", { name: "Not worth applying" });
    expect(downButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(downButton);
    const report = screen.getByRole("button", { name: "Report" }) as HTMLButtonElement;
    expect(report.disabled).toBe(true); // no reason picked yet
    fireEvent.click(screen.getByLabelText("Not actually remote"));
    await act(async () => {
      fireEvent.click(report);
    });

    const put = fetchMock.mock.calls.find(([u, i]) => u === "/api/jobs/42/vote" && i?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ vote: "down", reason: "not_remote" });
    expect(screen.getByRole("button", { name: "Not worth applying" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("You reported: Not actually remote.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Thanks, reported: Not actually remote");
  });

  it("'Other' needs a note; a failed vote rolls back", async () => {
    sessionMock.me = { user: { role: "user" } };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/me/job-votes")) return Promise.resolve(json(200, { votes: {}, community: {} }));
      if (init?.method === "PUT") return Promise.resolve(json(429, { error: { code: "rate_limited", message: "slow down" } }));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      render(<JobVotePanel job={{ ...JOB, community: FLAGGED }} signedIn />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Not worth applying" }));
    fireEvent.click(screen.getByLabelText("Other"));
    const report = screen.getByRole("button", { name: "Report" }) as HTMLButtonElement;
    expect(report.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What's wrong? (required)"), { target: { value: "Closed" } });
    expect(report.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(report);
    });

    expect(screen.getByRole("button", { name: "Not worth applying" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("3 people say it's not worth applying")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Too many votes in the last hour. Try again later.");
  });
});
