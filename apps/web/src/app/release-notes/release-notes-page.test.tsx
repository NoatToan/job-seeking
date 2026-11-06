import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import i18n from "@/lib/i18n";
import { isPublicRoute } from "@/lib/public-routes";
import { RELEASE_NOTES } from "@/lib/release-notes";
import type { ReleaseEntry } from "@/lib/release-notes";
import sitemap from "@/app/sitemap";
import { GET } from "./feed.xml/route";
import { ReleaseNotesPage } from "./release-notes-page";
import { WhatsNewChip } from "./whats-new-chip";

const entries: ReleaseEntry[] = [
  {
    date: "2026-11-07",
    slug: "2026-11-07",
    title: { en: "A public roadmap", vi: "Lộ trình công khai" },
    highlights: [
      { category: "new", en: "Vote for ideas", vi: "Bình chọn ý tưởng" },
      { category: "fixed", en: "Dates no longer jump", vi: "Ngày không còn nhảy" },
    ],
    commits: { from: "aaaaaaa", to: "bbbbbbb", count: 6 },
  },
  {
    date: "2026-11-02",
    slug: "2026-11-02",
    title: { en: "Application tracker", vi: "Theo dõi ứng tuyển" },
    highlights: [{ category: "improved", en: "Faster lists", vi: "Danh sách nhanh hơn" }],
    screenshot: "/release-notes/2026-11-06-home.jpg",
    commits: { from: "ccccccc", to: "ddddddd", count: 22 },
  },
];

describe("Release notes page", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 7, 9, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    void i18n.changeLanguage("en");
  });

  it("shows the activity summary, the latest entry first and every highlight with its category", () => {
    render(<ReleaseNotesPage builtAt="2026-11-07T00:00:00.000Z" entries={entries} />);
    expect(screen.getByTestId("activity-updates").textContent).toBe("3 updates in the last 30 days");
    expect(screen.getByText("2 release days")).toBeTruthy();
    expect(screen.getByText("28 code changes")).toBeTruthy();

    const items = screen.getAllByRole("listitem").filter((li) => li.id);
    expect(items.map((li) => li.id)).toEqual(["2026-11-07", "2026-11-02"]);
    expect(within(items[0]).getByText("Latest")).toBeTruthy();
    expect(within(items[1]).queryByText("Latest")).toBeNull();
    expect(within(items[0]).getByText("Vote for ideas")).toBeTruthy();
    expect(within(items[0]).getAllByText("Fixed").length).toBeGreaterThan(0);
    expect(within(items[1]).getByRole("img", { name: /The site on/ }).getAttribute("src")).toBe(
      "/release-notes/2026-11-06-home.jpg",
    );
    // No link to the source code (release notes are for users, not a commit log).
    expect(within(items[0]).queryByRole("link", { name: /View code/ })).toBeNull();
    expect(screen.getByRole("link", { name: "RSS feed" }).getAttribute("href")).toBe("/release-notes/feed.xml");
    expect(screen.getByRole("img", { name: "Code changes per day, last 12 weeks" })).toBeTruthy();
  });

  it("filters by category and hides entries with nothing left", () => {
    render(<ReleaseNotesPage builtAt="2026-11-07T00:00:00.000Z" entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Improved" }));
    expect(screen.getByRole("button", { name: "Improved" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Vote for ideas")).toBeNull();
    expect(screen.getByText("Faster lists")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Vote for ideas")).toBeTruthy();
  });

  it("speaks Vietnamese", async () => {
    await i18n.changeLanguage("vi");
    render(<ReleaseNotesPage builtAt="2026-11-07T00:00:00.000Z" entries={entries} />);
    expect(screen.getByText("Lộ trình công khai")).toBeTruthy();
    expect(screen.getByTestId("activity-updates").textContent).toBe("3 cập nhật trong 30 ngày qua");
    expect(screen.getAllByText("Đã sửa").length).toBeGreaterThan(0);
  });

  it("renders the committed notes", () => {
    render(<ReleaseNotesPage builtAt="2026-11-07T00:00:00.000Z" />);
    expect(screen.getByText(RELEASE_NOTES.entries[0].title.en)).toBeTruthy();
  });

  it("'What's new' chip links to the page with the latest date", () => {
    render(<WhatsNewChip />);
    const link = screen.getByRole("link", { name: /What's new: latest update/ });
    expect(link.getAttribute("href")).toMatch(/^\/release-notes\/?$/);
  });

  it("is a public, indexed route with an Atom feed", async () => {
    expect(isPublicRoute("/release-notes/")).toBe(true);
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContainEqual(expect.stringMatching(/\/release-notes\/$/));
    expect(urls).toContainEqual(expect.stringMatching(/\/release-notes\/feed\.xml$/));
    const res = GET();
    expect(res.headers.get("Content-Type")).toContain("application/atom+xml");
    const xml = await res.text();
    expect(xml.match(/<entry>/g)).toHaveLength(RELEASE_NOTES.entries.length);
  });
});
