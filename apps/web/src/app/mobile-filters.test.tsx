import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OnUrlUpdateFunction, withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { ToastProvider } from "@ujc/ui";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { Home } from "./home";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const JOB = {
  id: "1",
  source: "weworkremotely",
  url: "https://example.com/1",
  applyUrl: null,
  title: "React Dev",
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

class FakeIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

/** Phone viewport: only the `(max-width: 767.98px)` query matches. */
function phoneMatchMedia(query: string) {
  return {
    matches: query.includes("max-width: 767.98px"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  };
}

function renderPhoneHome(searchParams = "", onUrlUpdate?: OnUrlUpdateFunction) {
  return render(
    <ToastProvider>
      <Home />
    </ToastProvider>,
    { wrapper: withNuqsTestingAdapter({ searchParams, onUrlUpdate }) },
  );
}

describe("phone filters (one modal view)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useSessionMock.mockReturnValue({ me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() });
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    vi.stubGlobal("matchMedia", phoneMatchMedia);
    fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/sources")) return Promise.resolve(jsonResponse([]));
      if (url.startsWith("/api/jobs/facets")) {
        return Promise.resolve(jsonResponse({ countries: [{ code: "DE", count: 12 }], tech: [{ id: "react", count: 30 }] }));
      }
      if (url.startsWith("/api/jobs")) return Promise.resolve(jsonResponse({ items: [JOB], nextCursor: null }));
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  const listCalls = () =>
    fetchMock.mock.calls.map(([u]) => u as string).filter((u) => /^\/api\/jobs(\?|$)/.test(u));

  it("replaces the pill row with one Filters button (no pills, no sideways row)", async () => {
    renderPhoneHome("?remote=true&posted=7");
    await waitFor(() => expect(screen.getByText("React Dev")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByRole("button", { name: "Filters, 2 on" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /More filters/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("edits a draft, then Apply writes every filter to the URL in one update", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    renderPhoneHome("", onUrlUpdate);
    await waitFor(() => expect(screen.getByText("React Dev")).toBeTruthy(), { timeout: 5000 });
    const callsBefore = listCalls().length;

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Past 7 days" }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "Remote jobs only" }));

    // A sub-choice is a step inside the same dialog, not a popover.
    fireEvent.click(within(dialog).getByRole("button", { name: /^Country/ }));
    const countryStep = screen.getByRole("dialog", { name: "Country" });
    fireEvent.click(await within(countryStep).findByRole("radio", { name: /Germany/ }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
    // Focus comes back to the row that opened the step.
    await waitFor(() => expect(document.activeElement?.getAttribute("data-step")).toBe("country"));

    // Nothing is applied while choosing.
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(listCalls().length).toBe(callsBefore);

    // A double tap on Apply still applies once.
    fireEvent.click(screen.getByRole("button", { name: "Show jobs" }));
    fireEvent.click(screen.getByRole("button", { name: "Show jobs" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledTimes(1));
    const params = onUrlUpdate.mock.calls[0][0].searchParams;
    expect(params.get("posted")).toBe("7");
    expect(params.get("remote")).toBe("true");
    expect(params.get("country")).toBe("DE");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Reset clears the draft; closing without Apply discards it", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    renderPhoneHome("?remote=true", onUrlUpdate);
    await waitFor(() => expect(screen.getByText("React Dev")).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Filters, 1 on" }));
    let dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByRole("switch", { name: "Remote jobs only" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect(within(dialog).getByRole("switch", { name: "Remote jobs only" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onUrlUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Filters, 1 on" }));
    dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByRole("switch", { name: "Remote jobs only" }).getAttribute("aria-checked")).toBe("true");
  });
});
