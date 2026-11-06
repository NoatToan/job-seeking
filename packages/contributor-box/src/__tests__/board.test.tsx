import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContributorBoard } from "../board";
import { fakeApi, makeItem, wrap } from "./helpers";

afterEach(cleanup);

describe("ContributorBoard", () => {
  it("lists the board sorted by votes and toggles a vote", async () => {
    const api = fakeApi({
      list: vi.fn(async () => ({ items: [makeItem({ id: "1", title: "Dark mode", voteCount: 2 })], total: 1, limit: 20, offset: 0 })),
    });
    render(<ContributorBoard />, { wrapper: wrap(api) });
    expect(await screen.findByText("Dark mode")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith({ scope: "board", sort: "top", kind: undefined, limit: 20, offset: 0 });
    const vote = screen.getByRole("button", { name: /^Vote \(2 votes\)/ });
    expect(vote.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(vote);
    await waitFor(() => expect(api.vote).toHaveBeenCalledWith("1", true));
    expect((await screen.findByRole("button", { name: /Remove vote/ })).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to My feedback and shows the empty state", async () => {
    const api = fakeApi();
    render(<ContributorBoard />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByLabelText("My feedback"));
    expect(await screen.findByText(/haven't sent anything yet/)).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith({ scope: "mine", sort: "new", kind: undefined, limit: 20, offset: 0 });
  });

  it("opens a detail with the team reply and history, rendering text (never HTML)", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const api = fakeApi({
      list: vi.fn(async () => ({ items: [makeItem({ id: "5", title: evil })], total: 1, limit: 20, offset: 0 })),
      get: vi.fn(async () =>
        makeItem({
          id: "5",
          title: evil,
          adminResponse: "Shipping next week",
          isMine: true,
          context: {
            pageUrl: "javascript:alert(1)",
            pageTitle: null,
            elementSelector: null,
            elementText: null,
            region: null,
            viewportWidth: null,
            viewportHeight: null,
            hasScreenshot: true,
            userAgent: null,
          },
          notes: [
            { id: "n1", kind: "status", visibility: "public", body: "status changed", fromStatus: "new", toStatus: "approved", createdAt: "2026-11-01T10:00:00Z", authorEmail: null },
          ],
        }),
      ),
    });
    const { container } = render(<ContributorBoard />, { wrapper: wrap(api) });
    fireEvent.click(await screen.findByText(evil));
    expect(await screen.findByText("Shipping next week")).toBeTruthy();
    expect(screen.getByText("New → Approved")).toBeTruthy();
    expect(container.querySelector("img[src=x]")).toBeNull();
    // Unsafe page URL is shown as text, not as a link.
    expect(screen.queryByRole("link", { name: /javascript/ })).toBeNull();
    expect(screen.getByAltText(/Screenshot/).getAttribute("src")).toBe("/api/feedback/5/screenshot");
  });

  it("submits a new idea without page context", async () => {
    const api = fakeApi();
    render(<ContributorBoard />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByRole("button", { name: "Suggest an idea" }));
    expect(screen.queryByRole("button", { name: "Point at the page" })).toBeNull();
    const form = screen.getByLabelText("Title").closest("form")!;
    expect(within(form).getByLabelText("Feature idea")).toHaveProperty("checked", true);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Export to CSV" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ kind: "idea", title: "Export to CSV", body: "" }));
  });
});
