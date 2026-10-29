import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock, refreshMock, signOutMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  refreshMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { CvPage } from "./cv-page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CvPage", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com" },
        preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
        latestCv: null,
      },
      loading: false,
      error: null,
      refresh: refreshMock,
      signOut: signOutMock,
    });
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanup();
  });

  it("uploads a CV, polls until done, and lets the user edit + save keywords", async () => {
    vi.useFakeTimers();
    let getCvCalls = 0;
    const baseCv = {
      id: "9",
      filename: "resume.pdf",
      error: null as string | null,
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/cvs" && method === "POST") {
        return Promise.resolve(
          jsonResponse(202, {
            ...baseCv,
            status: "queued",
            keywords: [],
            profile: null,
            processedAt: null,
          }),
        );
      }
      if (url === "/api/cvs/9") {
        getCvCalls += 1;
        if (getCvCalls < 2) {
          return Promise.resolve(
            jsonResponse(200, {
              ...baseCv,
              status: "queued",
              keywords: [],
              profile: null,
              processedAt: null,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            ...baseCv,
            status: "done",
            keywords: ["react", "node"],
            profile: {
              headline: "Frontend Engineer",
              seniority: "Senior",
              skills: [],
              summary: "Builds UIs.",
            },
            processedAt: new Date().toISOString(),
          }),
        );
      }
      if (url === "/api/me/preferences" && method === "PUT") {
        return Promise.resolve(jsonResponse(200, { preferences: JSON.parse(init!.body as string) }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CvPage />);

    const file = new File(["dummy content"], "resume.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Scanning your CV…")).toBeTruthy();

    // First poll tick: still queued.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Scanning your CV…")).toBeTruthy();

    // Second poll tick: done.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
    expect(screen.getByText("react")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
    expect(getCvCalls).toBe(2);

    fireEvent.click(screen.getByLabelText("Remove react"));
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "typescript" } });
    fireEvent.keyDown(screen.getByLabelText("Keywords"), { key: "Enter" });

    expect(screen.queryByText("react")).toBeNull();
    expect(screen.getByText("typescript")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.advanceTimersByTimeAsync(0);
    });

    const prefCall = fetchMock.mock.calls.find(([u]) => u === "/api/me/preferences");
    expect(prefCall).toBeTruthy();
    const [, prefInit] = prefCall as [string, RequestInit];
    expect(JSON.parse(prefInit.body as string)).toEqual({
      keywords: ["node", "typescript"],
      remoteOnly: false,
      candidateCountry: null,
    });
  });
});
