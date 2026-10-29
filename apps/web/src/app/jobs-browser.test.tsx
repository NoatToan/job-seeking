import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
}));

import { JobsBrowser } from "./jobs-browser";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sampleJob = {
  id: "1",
  source: "weworkremotely",
  url: "https://example.com/job/1",
  applyUrl: null,
  title: "Senior Frontend Engineer",
  company: "Acme",
  location: "Remote",
  remote: true,
  employmentType: "full_time",
  salaryText: null,
  tags: ["react"],
  openTo: null,
  postedAt: null,
  firstSeenAt: new Date().toISOString(),
};

describe("JobsBrowser", () => {
  beforeEach(() => {
    for (const key of Array.from(searchParamsMock.keys())) searchParamsMock.delete(key);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("calls GET /api/jobs and GET /api/sources, and renders items from the response", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(
          jsonResponse(200, { items: [sampleJob], total: 1, page: 1, pageSize: 50 }),
        );
      }
      if (url.startsWith("/api/sources")) {
        return Promise.resolve(jsonResponse(200, []));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JobsBrowser />);

    await waitFor(() => expect(screen.getByText("Senior Frontend Engineer")).toBeTruthy());

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.startsWith("/api/jobs"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/sources"))).toBe(true);
  });

  it("shows the empty state when there are no jobs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 50 }));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JobsBrowser />);

    await waitFor(() => expect(screen.getByText(/No jobs match/)).toBeTruthy());
  });

  it("shows an error state when the jobs request fails", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(
          jsonResponse(500, { error: { code: "internal_error", message: "boom" } }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<JobsBrowser />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
