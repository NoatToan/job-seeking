import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { MeResponse } from "@ujc/core";

const { useSessionMock, pathnameMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  pathnameMock: vi.fn(() => "/"),
}));

vi.mock("@/lib/session", () => ({ useSession: () => useSessionMock() }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
// Contributor widget + GitHub star count are out of scope here (own tests, network).
vi.mock("@contributor-box/react", () => ({ FeedbackWidget: () => null }));
vi.mock("@/lib/contributor", () => ({ ContributorRoot: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/app/github-link", () => ({ GitHubLink: () => null }));

import { activeKeyFor, AppShell } from "./nav";

function me(overrides: Partial<MeResponse["user"]> = {}): MeResponse {
  return {
    user: {
      id: "1",
      email: "linh@example.com",
      aiConsentAt: null,
      onboardedAt: "2026-01-01T00:00:00Z",
      role: "user",
      displayName: null,
      headline: null,
      ...overrides,
    },
    preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
    latestCv: null,
  };
}

function session(value: MeResponse | null) {
  useSessionMock.mockReturnValue({
    me: value,
    loading: false,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
    mutate: vi.fn(),
  });
}

function renderShell(path = "/") {
  pathnameMock.mockReturnValue(path);
  return render(
    <AppShell>
      <p>page</p>
    </AppShell>,
  );
}

const topNav = () => screen.getAllByRole("navigation", { name: "Main" })[0];
const tabBar = () => screen.getAllByRole("navigation", { name: "Main" })[1];

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("activeKeyFor", () => {
  it("maps public and personal places", () => {
    expect(activeKeyFor("/")).toBe("feed");
    expect(activeKeyFor("/roadmap/")).toBe("roadmap");
    expect(activeKeyFor("/tracker/")).toBe("tracker");
    expect(activeKeyFor("/search/")).toBe("search");
    expect(activeKeyFor("/profile/")).toBe("profile");
    expect(activeKeyFor("/admin/feedback/")).toBe("adminFeedback");
    expect(activeKeyFor("/jobs/view/")).toBe("");
  });
});

describe("AppShell, signed out", () => {
  beforeEach(() => session(null));

  it("top bar: public places only, plus Sign in; tab bar: Jobs, Roadmap, Sign in", () => {
    renderShell("/");
    const top = within(topNav());
    expect(top.getAllByRole("link").map((a) => a.textContent)).toEqual(["Jobs", "Roadmap", "What's new"]);
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /profile menu/i })).toBeNull();
    const tabs = within(tabBar());
    expect(tabs.getAllByRole("link").map((a) => a.textContent)).toEqual(["Jobs", "Roadmap", "What's new", "Sign in"]);
    // The blog stays hidden from navigation.
    expect(screen.queryByRole("link", { name: "Blog" })).toBeNull();
  });
});

describe("AppShell, signed in", () => {
  it("top bar keeps only public places; personal ones move to the avatar menu", () => {
    session(me());
    renderShell("/");
    expect(within(topNav()).getAllByRole("link").map((a) => a.textContent)).toEqual(["Jobs", "Roadmap", "What's new"]);
    const avatar = screen.getByRole("button", { name: "Profile menu for linh@example.com" });
    expect(avatar.getAttribute("aria-haspopup")).toBe("menu");
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
    expect(avatar.getAttribute("data-active")).toBeNull();
  });

  it("phone tab bar: Jobs, Tracker, CV, Profile", () => {
    session(me());
    renderShell("/");
    const tabs = within(tabBar());
    expect(tabs.getAllByRole("link").map((a) => a.textContent)).toEqual(["Jobs", "Tracker", "My CV"]);
    expect(tabs.getByRole("button", { name: "Profile" }).getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("opens the menu with the keyboard, moves with arrows, and Esc returns focus", async () => {
    session(me({ displayName: "Linh Nguyen", headline: "Senior React developer" }));
    renderShell("/");
    const avatar = screen.getByRole("button", { name: "Profile menu for Linh Nguyen" });
    avatar.focus();
    fireEvent.keyDown(avatar, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Profile menu" });
    expect(avatar.getAttribute("aria-expanded")).toBe("true");
    expect(within(menu).getByText("Linh Nguyen")).toBeTruthy();
    expect(within(menu).getByText("linh@example.com")).toBeTruthy();
    expect(within(menu).getByText("Senior React developer")).toBeTruthy();

    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "For you",
      "Live search",
      "Tracker",
      "My CV",
      "Connections",
      "Contribute",
      "Edit profile",
      "Account & privacy",
      "Sign out",
    ]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(items[items.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(items[items.length - 1], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(avatar);
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows Review feedback to admins only", async () => {
    session(me({ role: "admin" }));
    renderShell("/");
    fireEvent.click(screen.getByRole("button", { name: /profile menu for/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Review feedback" }).getAttribute("href")).toMatch(/^\/admin\/feedback\/?$/);
  });

  it("marks the avatar and the menu item when the page is inside the menu", async () => {
    session(me());
    renderShell("/search/");
    const avatar = screen.getByRole("button", { name: /profile menu for/i });
    expect(avatar.getAttribute("data-active")).toBe("true");
    expect(within(topNav()).queryByRole("link", { current: "page" })).toBeNull();
    fireEvent.click(avatar);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Live search" }).getAttribute("aria-current")).toBe("page");
    // On phones the Profile tab carries the active state instead.
    expect(within(tabBar()).getByRole("button", { name: "Profile" }).getAttribute("data-active")).toBe("true");
  });

  it("phone Profile tab opens the sheet without the places that have tabs", async () => {
    session(me());
    renderShell("/roadmap/");
    fireEvent.click(within(tabBar()).getByRole("button", { name: "Profile" }));
    const sheet = await screen.findByRole("dialog", { name: "Profile" });
    const links = within(sheet).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual([
      "For you",
      "Live search",
      "Connections",
      "Contribute",
      "Roadmap",
      "What's new",
      "Edit profile",
      "Account & privacy",
    ]);
    expect(within(sheet).getByRole("link", { name: "Roadmap" }).getAttribute("aria-current")).toBe("page");
    expect(within(sheet).getByRole("button", { name: "Sign out" })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(document.activeElement ?? sheet, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
