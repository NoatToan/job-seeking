import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@ujc/ui";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { Home } from "./home";

function renderHome() {
  return render(
    <ToastProvider>
      <Home />
    </ToastProvider>,
  );
}

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

function signedOutSession() {
  return { me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() };
}

function signedInSession() {
  return {
    me: {
      user: { id: "1", email: "person@example.com" },
      preferences: { keywords: ["react"], remoteOnly: false, candidateCountry: null },
      latestCv: null,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
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

describe("Home", () => {
  beforeEach(() => {
    ioCallback = null;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the public jobs list and calls GET /api/jobs (not /api/feed) when signed out", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(
          jsonResponse(200, { items: [job("1", "Remote Dev")], nextCursor: null }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();

    await waitFor(() => expect(screen.getByText("Remote Dev")).toBeTruthy(), { timeout: 5000 });

    const feedCalls = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/feed"));
    expect(feedCalls).toHaveLength(0);
    const jobsCalls = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/jobs"));
    expect(jobsCalls.length).toBeGreaterThan(0);

    // The "sign in to get matches" CTA is the public hero's call to action, and links to /login/
    // (next/link's trailingSlash normalisation doesn't run in this unit-test environment).
    expect(
      screen.getByRole("link", { name: /Sign in to get matches from your CV/i }).getAttribute("href"),
    ).toMatch(/^\/login\/?$/);
  });

  it("infinite scroll requests the next cursor exactly once per sentinel intersection", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    let resolvePage2!: (res: Response) => void;
    const page2Promise = new Promise<Response>((resolve) => {
      resolvePage2 = resolve;
    });

    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs")) {
        if (url.includes("cursor=")) {
          expect(url).toContain("cursor=abc");
          return page2Promise;
        }
        return Promise.resolve(
          jsonResponse(200, { items: [job("1", "Job One")], nextCursor: "abc" }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();

    await waitFor(() => expect(screen.getByText("Job One")).toBeTruthy(), { timeout: 5000 });
    const jobsCallsAfterPage1 = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/jobs"));
    expect(jobsCallsAfterPage1).toHaveLength(1);

    // Fire the sentinel twice in quick succession — the in-flight guard should still only issue
    // one request for page 2.
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
      ioCallback?.([{ isIntersecting: true }]);
    });

    const jobsCallsWhileLoading = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/jobs"));
    expect(jobsCallsWhileLoading).toHaveLength(2); // page 1 + exactly one page-2 request

    await act(async () => {
      resolvePage2(jsonResponse(200, { items: [job("2", "Job Two")], nextCursor: null }));
    });

    await waitFor(() => expect(screen.getByText("Job Two")).toBeTruthy(), { timeout: 5000 });
    const jobsCallsFinal = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/jobs"));
    expect(jobsCallsFinal).toHaveLength(2);
  });

  it("still renders Feed when signed in", async () => {
    useSessionMock.mockReturnValue(signedInSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/feed")) {
        return Promise.resolve(
          jsonResponse(200, { items: [job("1", "Feed Job")], nextCursor: null, keywords: ["react"] }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();

    await waitFor(() => expect(screen.getByText("Feed Job")).toBeTruthy(), { timeout: 5000 });
    const jobsCalls = fetchMock.mock.calls.filter(([u]) => (u as string).startsWith("/api/jobs"));
    expect(jobsCalls).toHaveLength(0);
  });
});
