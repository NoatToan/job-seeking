import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { Tracker } from "./tracker";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function application(id: string, title: string, status: string) {
  return {
    id,
    jobId: `job-${id}`,
    job: { title, company: "Acme", url: `https://example.com/${id}`, source: "weworkremotely" },
    status,
    note: null,
    nextActionAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Tracker", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com" },
        preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
        latestCv: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders board columns grouped by status from the API", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/applications") {
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              application("1", "Frontend Engineer", "saved"),
              application("2", "Backend Engineer", "applied"),
            ],
          }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Tracker />);

    expect(await screen.findByText("Frontend Engineer")).toBeTruthy();
    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Saved" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Applied" })).toBeTruthy();
  });

  it("PATCHes the application when its status changes", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/applications" && method === "GET") {
        return Promise.resolve(
          jsonResponse(200, { items: [application("1", "Frontend Engineer", "saved")] }),
        );
      }
      if (url === "/api/applications/1" && method === "PATCH") {
        return Promise.resolve(
          jsonResponse(200, { ...application("1", "Frontend Engineer", "applied") }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Tracker />);

    await screen.findByText("Frontend Engineer");

    const select = screen.getByLabelText("Status for Frontend Engineer");
    await act(async () => {
      fireEvent.change(select, { target: { value: "applied" } });
    });

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([u, i]) => u === "/api/applications/1" && (i as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const [, init] = patchCall as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ status: "applied" });
    });
  });

  it("shows an empty state when there is nothing tracked", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/applications") return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Tracker />);

    expect(await screen.findByText("Nothing tracked yet")).toBeTruthy();
  });
});
