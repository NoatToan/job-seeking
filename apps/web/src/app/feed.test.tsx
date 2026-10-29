import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { Feed } from "./feed";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function job(id: string, title: string) {
  return {
    id,
    source: "weworkremotely",
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

describe("Feed", () => {
  beforeEach(() => {
    ioCallback = null;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com" },
        preferences: { keywords: ["react"], remoteOnly: false, candidateCountry: null },
        latestCv: { id: "1", filename: "cv.pdf", status: "done", error: null, keywords: [], profile: null, createdAt: "", processedAt: "" },
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

  it("appends the next page exactly once per sentinel intersection, guarding duplicate in-flight loads", async () => {
    let resolvePage2!: (res: Response) => void;
    const page2Promise = new Promise<Response>((resolve) => {
      resolvePage2 = resolve;
    });

    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/feed")) {
        if (url.includes("cursor=")) {
          expect(url).toContain("cursor=abc");
          return page2Promise;
        }
        return Promise.resolve(
          jsonResponse(200, { items: [job("1", "Job One")], nextCursor: "abc", keywords: ["react"] }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Feed />);

    await waitFor(() => expect(screen.getByText("Job One")).toBeTruthy(), { timeout: 5000 });
    const feedCallsAfterPage1 = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/feed"));
    expect(feedCallsAfterPage1).toHaveLength(1);

    // Fire the sentinel twice in quick succession, simulating a rapid observer callback —
    // the in-flight guard should still only issue one request for page 2.
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
      ioCallback?.([{ isIntersecting: true }]);
    });

    const feedCallsWhileLoading = fetchMock.mock.calls.filter(([u]) =>
      (u as string).startsWith("/api/feed"),
    );
    expect(feedCallsWhileLoading).toHaveLength(2); // page 1 + exactly one page-2 request

    await act(async () => {
      resolvePage2(jsonResponse(200, { items: [job("2", "Job Two")], nextCursor: null, keywords: ["react"] }));
    });

    await waitFor(() => expect(screen.getByText("Job Two")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText("Job One")).toBeTruthy();

    const feedCallsFinal = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/feed"));
    expect(feedCallsFinal).toHaveLength(2);

    await waitFor(() => expect(screen.getByText(/reached the end of your feed/)).toBeTruthy(), {
      timeout: 5000,
    });
  });

  it("shows the empty state with a link to Live search when there are no matches", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/feed")) {
        return Promise.resolve(jsonResponse(200, { items: [], nextCursor: null, keywords: ["react"] }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Feed />);

    await waitFor(() => expect(screen.getByText(/No matches yet/)).toBeTruthy(), { timeout: 5000 });
  });
});
