import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { Home } from "./home";
import {
  ConnectionsSkeleton,
  HomeSkeleton,
  JobBrowserSkeleton,
  JobViewSkeleton,
  LoginSkeleton,
  TrackerSkeleton,
} from "./skeletons";
import { RequireAuth } from "@/lib/require-auth";

function loadingSession() {
  return { me: null, loading: true, error: null, refresh: vi.fn(), signOut: vi.fn() };
}

afterEach(() => cleanup());

describe("screen skeletons", () => {
  it("JobBrowserSkeleton uses the JobBrowser grid: list column + detail panel", () => {
    render(<JobBrowserSkeleton label="Loading jobs" rows={4} actions />);
    const root = screen.getByTestId("job-browser-skeleton");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("aria-label")).toBe("Loading jobs");
    expect(root.className).toContain("lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]");
    expect(root.querySelectorAll("[data-skeleton=job-list-item]")).toHaveLength(4);
    // The detail panel: hidden on phones, the same rounded bordered frame on lg, panel variant.
    const panel = root.children[1];
    expect(panel.className).toContain("rounded-[22px]");
    expect(panel.className).toContain("hidden");
    expect(panel.className).toContain("lg:flex");
    expect(panel.querySelector("[data-skeleton=job-detail]")).toBeTruthy();
  });

  it("HomeSkeleton = hero + job browser, labelled, without any loading text", () => {
    const { container } = render(<HomeSkeleton />);
    expect(screen.getByLabelText("Loading jobs").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("section.hero-wash")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Loading/);
  });

  it("Home shows the skeleton (not a 'Loading…' line) while the session check runs", () => {
    useSessionMock.mockReturnValue(loadingSession());
    const { container } = render(<Home />, { wrapper: withNuqsTestingAdapter({ searchParams: "" }) });
    expect(screen.getByTestId("job-browser-skeleton")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Loading/);
  });

  it("RequireAuth renders the page's skeleton while the session loads, else an empty busy box", () => {
    useSessionMock.mockReturnValue(loadingSession());
    const { container } = render(
      <RequireAuth fallback={<TrackerSkeleton />}>
        <p>secret</p>
      </RequireAuth>,
    );
    expect(screen.getByLabelText("Loading your tracker")).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect(container.textContent).not.toMatch(/Checking/);
    cleanup();
    const bare = render(
      <RequireAuth>
        <p>secret</p>
      </RequireAuth>,
    );
    const busy = bare.container.querySelector("[aria-busy=true]");
    expect(busy).toBeTruthy();
    expect(busy?.textContent).toBe("");
  });

  it("TrackerSkeleton mirrors the five-column board", () => {
    render(<TrackerSkeleton />);
    const board = screen.getByLabelText("Loading your tracker");
    expect(board.className).toContain("lg:grid-cols-5");
    expect(board.children).toHaveLength(5);
  });

  it("ConnectionsSkeleton: grouped list of sources + connection cards", () => {
    const { container } = render(<ConnectionsSkeleton />);
    expect(screen.getByLabelText("Loading your connections").getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("ul.rounded-card")?.children.length).toBeGreaterThan(0);
  });

  it("JobViewSkeleton uses the job page frame and the page variant of the detail", () => {
    render(<JobViewSkeleton />);
    const frame = screen.getByLabelText("Loading job");
    expect(frame.className).toContain("rounded-[22px]");
    expect(frame.className).toContain("sm:p-7");
    // Page variant: one button (Track) in the buttons row.
    expect(frame.querySelectorAll("[data-skeleton=job-detail] > :nth-child(3) > *")).toHaveLength(1);
  });

  it("LoginSkeleton keeps the sign-in page's column", () => {
    render(<LoginSkeleton />);
    const main = screen.getByLabelText("Loading sign in");
    expect(main.tagName).toBe("MAIN");
    expect(main.className).toContain("max-w-[400px]");
  });
});
