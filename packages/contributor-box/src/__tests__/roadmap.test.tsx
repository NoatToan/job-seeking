import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListFeedbackQuery } from "../types";
import { Roadmap } from "../roadmap";
import { relativeTime } from "../ui";
import { FeedbackWidget, OPEN_WIDGET_EVENT, openFeedbackWidget } from "../widget";
import { fakeApi, makeItem, wrap } from "./helpers";

afterEach(cleanup);

const BY_STATUS = {
  approved: [makeItem({ id: "1", title: "Salary in VND", status: "approved", voteCount: 5, adminResponse: "Looking into it" })],
  planned: [makeItem({ id: "2", title: "Dark mode", status: "planned", kind: "feedback", voteCount: 3 })],
  done: [] as ReturnType<typeof makeItem>[],
};

function roadmapApi(signedIn: boolean) {
  return fakeApi({
    list: vi.fn(async (q: ListFeedbackQuery = {}) => {
      const items = BY_STATUS[q.status as keyof typeof BY_STATUS].map((i) =>
        signedIn ? i : { ...i, canVote: false, voted: false },
      );
      return { items, total: items.length, limit: 20, offset: 0 };
    }),
    stats: vi.fn(async () => ({ counts: { approved: 1, planned: 1, done: 0 }, total: 2 })),
  });
}

function column(name: string): HTMLElement {
  return screen.getByRole("heading", { name }).closest("section")!;
}

describe("Roadmap", () => {
  it("loads one column per public status from the board, with totals and empty states", async () => {
    const api = roadmapApi(true);
    render(<Roadmap />, { wrapper: wrap(api) });
    expect(await screen.findByText("Salary in VND")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith({ scope: "board", status: "approved", sort: "top", limit: 20, offset: 0 });
    expect(api.list).toHaveBeenCalledWith({ scope: "board", status: "planned", sort: "top", limit: 20, offset: 0 });
    expect(api.list).toHaveBeenCalledWith({ scope: "board", status: "done", sort: "new", limit: 20, offset: 0 });
    expect(await screen.findByText("2 items on the roadmap")).toBeTruthy();
    expect(within(column("Under consideration")).getByText("Salary in VND")).toBeTruthy();
    expect(within(column("Under consideration")).getByText("Looking into it")).toBeTruthy();
    expect(within(column("Planned")).getByText("Dark mode")).toBeTruthy();
    expect(within(column("Planned")).getByText("Feedback")).toBeTruthy();
    expect(within(column("Done")).getByText("Nothing shipped yet.")).toBeTruthy();
    // Private statuses are never asked for.
    for (const [q] of vi.mocked(api.list).mock.calls) {
      expect(["approved", "planned", "done"]).toContain(q?.status);
    }
  });

  it("lets signed-in users vote from a card", async () => {
    const api = roadmapApi(true);
    render(<Roadmap />, { wrapper: wrap(api) });
    fireEvent.click(await screen.findByRole("button", { name: /^Vote \(5 votes\)/ }));
    await waitFor(() => expect(api.vote).toHaveBeenCalledWith("1", true));
  });

  it("shows signed-out visitors the count as a sign-in link, never a vote button", async () => {
    const api = roadmapApi(false);
    render(<Roadmap />, { wrapper: wrap(api, false, true) });
    await screen.findByText("Salary in VND");
    expect(screen.queryByRole("button", { name: /^Vote/ })).toBeNull();
    const hint = screen.getByRole("link", { name: "Sign in to vote (5 votes)" });
    expect(hint.getAttribute("href")).toBe("/login/");
  });

  it("opens the detail in a dialog and closes it with Escape, returning focus", async () => {
    const api = roadmapApi(false);
    render(<Roadmap />, { wrapper: wrap(api, false, true) });
    const card = await screen.findByRole("button", { name: /Salary in VND/ });
    card.focus();
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("1"));
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(card);
  });

  it("'Suggest an idea' opens the feedback widget with Feature idea preselected", async () => {
    const api = roadmapApi(false);
    render(
      <>
        <Roadmap />
        <FeedbackWidget />
      </>,
      { wrapper: wrap(api, false, true) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest an idea" }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByLabelText("Feature idea")).toHaveProperty("checked", true);
    expect(within(panel).getByText(/sending this as a guest/)).toBeTruthy();
  });

  it("hides the suggest button with onSuggest={false} and calls a custom handler", () => {
    const api = roadmapApi(true);
    const { unmount } = render(<Roadmap onSuggest={false} />, { wrapper: wrap(api) });
    expect(screen.queryByRole("button", { name: "Suggest an idea" })).toBeNull();
    unmount();
    const onSuggest = vi.fn();
    render(<Roadmap onSuggest={onSuggest} />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByRole("button", { name: "Suggest an idea" }));
    expect(onSuggest).toHaveBeenCalled();
  });

  it("shows a retry when a column fails to load", async () => {
    const api = fakeApi({ list: vi.fn(async () => Promise.reject(new Error("boom"))) });
    render(<Roadmap />, { wrapper: wrap(api) });
    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(3);
    expect(within(alerts[0]).getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("openFeedbackWidget", () => {
  it("dispatches the open event with the requested kind", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_WIDGET_EVENT, listener);
    act(() => openFeedbackWidget({ kind: "bug" }));
    window.removeEventListener(OPEN_WIDGET_EVENT, listener);
    expect(seen).toEqual([{ kind: "bug" }]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it("formats in the given locale and handles bad input", () => {
    expect(relativeTime("2026-11-03T12:00:00Z", "en", now)).toBe("3 days ago");
    expect(relativeTime("2026-11-06T11:00:00Z", "en", now)).toBe("1 hour ago");
    expect(relativeTime("2026-11-03T12:00:00Z", "vi", now)).toBe("3 ngày trước");
    expect(relativeTime(null, "en", now)).toBe("");
    expect(relativeTime("not a date", "en", now)).toBe("");
  });
});
