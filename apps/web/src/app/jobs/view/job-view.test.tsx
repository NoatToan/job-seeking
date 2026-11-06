import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

const searchParamsMock = new URLSearchParams();
const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { JobView } from "./job-view";

function signedInSession() {
  return {
    me: {
      user: { id: "1", email: "person@example.com" },
      preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
      latestCv: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

function signedOutSession() {
  return { me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JobView", () => {
  beforeEach(() => {
    for (const key of Array.from(searchParamsMock.keys())) searchParamsMock.delete(key);
    useSessionMock.mockReturnValue(signedInSession());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the job detail (with description line breaks) from GET /api/jobs/{id}", async () => {
    searchParamsMock.set("id", "42");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "42",
        source: "greenhouse",
        url: "https://example.com/job/42",
        applyUrl: "https://example.com/apply/42",
        title: "Staff Engineer",
        company: "Acme",
        location: null,
        remote: true,
        employmentType: "full_time",
        salaryText: null,
        tags: [],
        openTo: null,
        postedAt: null,
        firstSeenAt: new Date().toISOString(),
        description: "Line one\nLine two",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<JobView />, { wrapper: withNuqsTestingAdapter({ searchParams: searchParamsMock.toString() }) });

    await waitFor(() => expect(screen.getByText("Staff Engineer")).toBeTruthy());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/jobs/42");
  });

  it("shows an alert when the job id is missing", () => {
    render(<JobView />, { wrapper: withNuqsTestingAdapter({ searchParams: searchParamsMock.toString() }) });
    expect(screen.getByRole("alert").textContent).toContain("Missing job id");
  });

  it("shows an error state when the job fails to load", async () => {
    searchParamsMock.set("id", "999");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Job not found" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<JobView />, { wrapper: withNuqsTestingAdapter({ searchParams: searchParamsMock.toString() }) });

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Job not found");
  });

  it("works signed out, and the Track button prompts sign-in instead of saving", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    searchParamsMock.set("id", "42");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "42",
        source: "greenhouse",
        url: "https://example.com/job/42",
        applyUrl: "https://example.com/apply/42",
        title: "Staff Engineer",
        company: "Acme",
        location: null,
        remote: true,
        employmentType: "full_time",
        salaryText: null,
        tags: [],
        openTo: null,
        postedAt: null,
        firstSeenAt: new Date().toISOString(),
        description: "Line one\nLine two",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<JobView />, { wrapper: withNuqsTestingAdapter({ searchParams: searchParamsMock.toString() }) });

    await waitFor(() => expect(screen.getByText("Staff Engineer")).toBeTruthy());
    const trackLink = screen.getByRole("link", { name: /Sign in to track/i });
    // next/link's trailingSlash normalisation doesn't run in this unit-test environment.
    expect(trackLink.getAttribute("href")).toMatch(/^\/login\/?$/);
    const calledPaths = fetchMock.mock.calls.map(([u]) => u as string);
    expect(calledPaths.every((u) => u !== "/api/applications")).toBe(true);
  });
});
