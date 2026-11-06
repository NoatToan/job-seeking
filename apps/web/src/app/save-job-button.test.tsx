import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { requireLoginMock } = vi.hoisted(() => ({ requireLoginMock: vi.fn() }));
vi.mock("@/lib/login-modal", () => ({ useRequireLogin: () => requireLoginMock }));

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

  it("signed out: opens the login modal in place and saves only after sign-in", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "1" }), { status: 201 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    requireLoginMock.mockReset();

    render(<SaveJobButton jobId="42" signedIn={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    // Not navigated, not saved yet: the modal was asked for, with the save as its follow-up.
    expect(requireLoginMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const [afterSignIn, options] = requireLoginMock.mock.calls[0];
    expect(options).toEqual({ reason: expect.any(String) });
    await act(async () => afterSignIn());
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/applications")).toBe(true);
  });
});
