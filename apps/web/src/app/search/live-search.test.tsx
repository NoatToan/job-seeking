import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { LiveSearch } from "./live-search";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function job(id: string, source: string, title: string) {
  return {
    id,
    source,
    url: `https://example.com/${id}`,
    applyUrl: null,
    title,
    company: "Acme",
    location: null,
    remote: true,
    employmentType: null,
    salaryText: null,
    tags: [],
    openTo: null,
    postedAt: null,
    firstSeenAt: new Date().toISOString(),
  };
}

type IoEntry = Pick<IntersectionObserverEntry, "isIntersecting">;
let ioCallback: ((entries: IoEntry[]) => void) | null = null;

class FakeIntersectionObserver {
  constructor(cb: (entries: IoEntry[]) => void) {
    ioCallback = cb;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("LiveSearch", () => {
  beforeEach(() => {
    ioCallback = null;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com" },
        preferences: { keywords: ["golang"], remoteOnly: false, candidateCountry: null },
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

  it("loads the next page via nextCursor and surfaces a per-source error", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/search/live")) {
        if (url.includes("cursor=")) {
          expect(url).toContain("cursor=page2");
          return Promise.resolve(
            jsonResponse(200, {
              items: [job("2", "seek", "Backend Engineer")],
              nextCursor: null,
              sources: [{ id: "seek", count: 1 }],
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(200, {
            items: [job("1", "seek", "Go Developer")],
            nextCursor: "page2",
            sources: [
              { id: "seek", count: 1 },
              { id: "wwr", count: 0, error: "timed out" },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LiveSearch />);

    await waitFor(() => expect(screen.getByText("Go Developer")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText(/We Work Remotely: timed out/)).toBeTruthy();

    const firstCall = fetchMock.mock.calls[0] as [string];
    expect(firstCall[0]).toContain("q=golang");
    expect(firstCall[0]).toContain("sources=seek%2Chimalayas%2Cremotive%2Cwwr%2Carc");

    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });

    await waitFor(() => expect(screen.getByText("Backend Engineer")).toBeTruthy(), { timeout: 5000 });

    const liveCalls = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/search/live"));
    expect(liveCalls).toHaveLength(2);

    await waitFor(
      () => expect(screen.getByText(/reached the end of these results/)).toBeTruthy(),
      { timeout: 5000 },
    );
  });
});
