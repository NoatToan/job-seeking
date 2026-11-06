import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** `GET /api/jobs` list pages only (not `/api/jobs/facets` or `/api/jobs/{id}`). */
function isJobsListCall(url: string): boolean {
  return /^\/api\/jobs(\?|$)/.test(url);
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
    const jobsCalls = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
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
    const jobsCallsAfterPage1 = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
    expect(jobsCallsAfterPage1).toHaveLength(1);

    // The first page renders a microtask before `loading` clears and the sentinel starts
    // observing; fire it only once the observer exists.
    await waitFor(() => expect(ioCallback).not.toBeNull());

    // Fire the sentinel twice in quick succession — the in-flight guard should still only issue
    // one request for page 2.
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
      ioCallback?.([{ isIntersecting: true }]);
    });

    const jobsCallsWhileLoading = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
    expect(jobsCallsWhileLoading).toHaveLength(2); // page 1 + exactly one page-2 request

    await act(async () => {
      resolvePage2(jsonResponse(200, { items: [job("2", "Job Two")], nextCursor: null }));
    });

    await waitFor(() => expect(screen.getByText("Job Two")).toBeTruthy(), { timeout: 5000 });
    const jobsCallsFinal = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
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
    const jobsCalls = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
    expect(jobsCalls).toHaveLength(0);
  });

  it("restores the list from the view cache on Back instead of refetching", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(jsonResponse(200, { items: [job("1", "Cached Job")], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHome();
    await waitFor(() => expect(screen.getByText("Cached Job")).toBeTruthy(), { timeout: 5000 });
    first.unmount(); // navigate to a job…

    renderHome(); // …and back: the list is on the very first render, no skeleton
    expect(screen.getByText("Cached Job")).toBeTruthy();
    const jobsCalls = fetchMock.mock.calls.filter(([u]) => isJobsListCall(u as string));
    expect(jobsCalls).toHaveLength(1);
  });

  it("on wide screens shows the selected job in the detail panel, and a click selects another", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      const detail = url.match(/^\/api\/jobs\/(\d+)/);
      if (detail) {
        return Promise.resolve(jsonResponse(200, { ...job(detail[1], `Job ${detail[1]}`), description: `About job ${detail[1]}` }));
      }
      if (url.startsWith("/api/jobs")) {
        return Promise.resolve(
          jsonResponse(200, { items: [job("1", "Job 1"), job("2", "Job 2")], nextCursor: null }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();

    // The first job is selected by default and its description loads into the panel.
    const panel = await screen.findByRole("complementary", { name: "Job details" });
    await waitFor(() => expect(panel.textContent).toContain("About job 1"), { timeout: 5000 });

    fireEvent.click(screen.getByRole("link", { name: "Job 2" }));
    await waitFor(() => expect(panel.textContent).toContain("About job 2"), { timeout: 5000 });
    expect(screen.getByText("Job 2", { selector: "a" }).closest("article")?.getAttribute("aria-current")).toBe("true");
  });

  it("filters by country from the facets list", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs/facets")) {
        return Promise.resolve(jsonResponse(200, { countries: [{ code: "DE", count: 3 }] }));
      }
      if (isJobsListCall(url)) {
        const title = url.includes("country=DE") ? "Berlin Job" : "Any Job";
        return Promise.resolve(jsonResponse(200, { items: [job("1", title)], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();
    await waitFor(() => expect(screen.getByText("Any Job")).toBeTruthy(), { timeout: 5000 });
    const select = await screen.findByRole("combobox", { name: "Country" });
    await waitFor(() => expect(select.textContent).toContain("Germany (3)"));

    fireEvent.change(select, { target: { value: "DE" } });
    await waitFor(() => expect(screen.getByText("Berlin Job")).toBeTruthy(), { timeout: 5000 });
  });

  it("filters by tech stack chips and shows tech icons on rows", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs/facets")) {
        return Promise.resolve(
          jsonResponse(200, { countries: [], tech: [{ id: "react", count: 9 }, { id: "python", count: 4 }] }),
        );
      }
      if (isJobsListCall(url)) {
        const item = url.includes("tech=react")
          ? { ...job("1", "React Job"), techStack: ["react", "nextjs"] }
          : job("2", "Any Job");
        return Promise.resolve(jsonResponse(200, { items: [item], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();
    await waitFor(() => expect(screen.getByText("Any Job")).toBeTruthy(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    const frontend = await screen.findByRole("group", { name: "Frontend tech" });
    expect(screen.getByRole("group", { name: "Backend tech" }).textContent).toContain("Python");

    fireEvent.click(within(frontend).getByRole("button", { name: /React/ }));
    await waitFor(() => expect(screen.getByText("React Job")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getAllByRole("img", { name: "Next.js" }).length).toBeGreaterThan(0);
  });

  it("filters by posted date (3 days / 7 days / month)", async () => {
    useSessionMock.mockReturnValue(signedOutSession());
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith("/api/jobs/facets")) return Promise.resolve(jsonResponse(200, { countries: [], tech: [] }));
      if (isJobsListCall(url)) {
        const title = url.includes("days=7") ? "This Week Job" : "Any Job";
        return Promise.resolve(jsonResponse(200, { items: [job("1", title)], nextCursor: null }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHome();
    await waitFor(() => expect(screen.getByText("Any Job")).toBeTruthy(), { timeout: 5000 });
    fireEvent.change(screen.getByRole("combobox", { name: "Posted" }), { target: { value: "7" } });
    await waitFor(() => expect(screen.getByText("This Week Job")).toBeTruthy(), { timeout: 5000 });
  });
});
