import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminReview } from "../admin";
import { fakeApi, makeItem, wrap } from "./helpers";

afterEach(cleanup);

const adminMeta = async () => ({ kinds: [], statuses: [], publicStatuses: [], isAdmin: true });

describe("AdminReview", () => {
  it("tells non-admins the page is for admins and never lists items", async () => {
    const api = fakeApi();
    render(<AdminReview />, { wrapper: wrap(api) });
    expect(await screen.findByText("This page is for admins.")).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("filters the queue, opens an item and saves only changed fields", async () => {
    const item = makeItem({
      id: "9",
      title: "Crash on save",
      kind: "bug",
      status: "new",
      author: { id: "2", email: "linh@example.com" },
      context: {
        pageUrl: "https://app.example.com/tracker/",
        pageTitle: "Tracker",
        elementSelector: "#save",
        elementText: "Save",
        region: { x: 1, y: 2, width: 3, height: 4 },
        viewportWidth: 1280,
        viewportHeight: 800,
        hasScreenshot: false,
        userAgent: "UA",
      },
    });
    const api = fakeApi({
      meta: vi.fn(adminMeta),
      list: vi.fn(async () => ({ items: [item], total: 1, limit: 20, offset: 0 })),
      get: vi.fn(async () => item),
      update: vi.fn(async () => ({ ...item, status: "planned" as const, adminResponse: "Soon" })),
    });
    render(<AdminReview />, { wrapper: wrap(api) });
    await screen.findByText("Crash on save");
    expect(api.list).toHaveBeenCalledWith({ scope: "all", sort: "new", status: "new", kind: undefined, q: undefined, limit: 20, offset: 0 });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.list).mock.lastCall?.[0]?.status).toBeUndefined();

    fireEvent.click(screen.getByText("Crash on save"));
    expect(await screen.findByText(/linh@example.com/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://app.example.com/tracker/" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("#save")).toBeTruthy();

    // The editor's <select> is labelled by a <label for>; the queue filter by aria-label.
    const editorStatus = document.querySelector<HTMLSelectElement>('select[id$="-status"]')!;
    fireEvent.change(editorStatus, { target: { value: "planned" } });
    fireEvent.change(screen.getByLabelText("Public reply"), { target: { value: "Soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("9", { status: "planned", adminResponse: "Soon" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("keeps the latest selection when an earlier detail request resolves last", async () => {
    let resolveFirst: (v: ReturnType<typeof makeItem>) => void = () => {};
    const first = makeItem({ id: "1", title: "First item" });
    const second = makeItem({ id: "2", title: "Second item" });
    const api = fakeApi({
      meta: vi.fn(adminMeta),
      list: vi.fn(async () => ({ items: [first, second], total: 2, limit: 20, offset: 0 })),
      get: vi.fn((id: string) =>
        id === "1" ? new Promise<typeof first>((r) => (resolveFirst = r)) : Promise.resolve(second),
      ),
    });
    render(<AdminReview />, { wrapper: wrap(api) });
    fireEvent.click(await screen.findByText("First item"));
    fireEvent.click(screen.getByText("Second item"));
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Second item"));
    resolveFirst(first);
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Second item");
  });

  it("adds an internal note", async () => {
    const item = makeItem({ id: "3", status: "new" });
    const api = fakeApi({
      meta: vi.fn(adminMeta),
      list: vi.fn(async () => ({ items: [item], total: 1, limit: 20, offset: 0 })),
      get: vi.fn(async () => item),
    });
    render(<AdminReview />, { wrapper: wrap(api) });
    fireEvent.click(await screen.findByText("Dark mode"));
    fireEvent.change(await screen.findByLabelText("Note"), { target: { value: "Check with design" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith("3", "Check with design", "internal"));
  });
});
