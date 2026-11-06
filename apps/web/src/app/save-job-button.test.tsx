import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveJobButton } from "./save-job-button";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SaveJobButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("POSTs once and shows the saved state", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/applications" && method === "POST") {
        return Promise.resolve(
          jsonResponse(201, {
            id: "1",
            jobId: "42",
            job: { title: "Frontend Engineer", company: "Acme", url: "https://example.com/42", source: "weworkremotely" },
            status: "saved",
            note: null,
            nextActionAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SaveJobButton jobId="42" />);

    const button = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(await screen.findByRole("button", { name: "Saved ✓" })).toBeTruthy();
    const postCalls = fetchMock.mock.calls.filter(
      ([u, i]) => u === "/api/applications" && (i as RequestInit | undefined)?.method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    expect(JSON.parse((postCalls[0][1] as RequestInit).body as string)).toEqual({ jobId: "42" });
  });

  it("prompts sign-in instead of calling the API when signedIn is false", () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("should not call the API")));
    vi.stubGlobal("fetch", fetchMock);

    render(<SaveJobButton jobId="42" signedIn={false} />);

    const link = screen.getByRole("link", { name: /Sign in to save/i });
    // next/link's own trailingSlash normalisation (next.config `trailingSlash: true`) doesn't
    // run in this unit-test environment, so just check the path rather than an exact match.
    expect(link.getAttribute("href")).toMatch(/^\/login\/?$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
