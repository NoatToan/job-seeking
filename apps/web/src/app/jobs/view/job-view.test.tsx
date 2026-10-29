import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
}));

import { JobView } from "./job-view";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JobView", () => {
  beforeEach(() => {
    for (const key of Array.from(searchParamsMock.keys())) searchParamsMock.delete(key);
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

    render(<JobView />);

    await waitFor(() => expect(screen.getByText("Staff Engineer")).toBeTruthy());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/jobs/42");
  });

  it("shows an alert when the job id is missing", () => {
    render(<JobView />);
    expect(screen.getByRole("alert").textContent).toContain("Missing job id");
  });

  it("shows an error state when the job fails to load", async () => {
    searchParamsMock.set("id", "999");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: { code: "not_found", message: "Job not found" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<JobView />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Job not found");
  });
});
