import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContributorBoard } from "../board";
import { CommentThread } from "../comments";
import { ContributorProvider } from "../context";
import { Roadmap } from "../roadmap";
import type { ListFeedbackQuery } from "../types";
import { FeedbackWidget } from "../widget";
import { fakeApi, makeItem, wrap } from "./helpers";

afterEach(cleanup);

describe("in-place sign-in (onRequireSignIn)", () => {
  it("keeps the arrows for guests, asks to sign in, then casts the vote", async () => {
    const onRequireSignIn = vi.fn();
    const api = fakeApi({
      list: vi.fn(async (q: ListFeedbackQuery = {}) => {
        const items = q.status === "approved" ? [makeItem({ id: "1", title: "Dark mode", canVote: false })] : [];
        return { items, total: items.length, limit: 20, offset: 0, nextCursor: null };
      }),
    });
    render(<Roadmap />, { wrapper: wrap(api, false, true, undefined, onRequireSignIn) });
    const down = await screen.findByRole("button", { name: "Downvote: Dark mode" });
    expect(down.getAttribute("title")).toBe("Sign in to vote");
    expect(screen.queryByRole("link", { name: /Sign in to vote/ })).toBeNull();
    fireEvent.click(down);
    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    expect(api.vote).not.toHaveBeenCalled();
    // The host runs `resume` once the visitor has signed in.
    const resume = onRequireSignIn.mock.calls[0][0] as () => void;
    resume();
    await waitFor(() => expect(api.vote).toHaveBeenCalledWith("1", -1));
  });

  it("asks to sign in from the comment thread and the widget instead of linking away", async () => {
    const onRequireSignIn = vi.fn();
    const api = fakeApi({
      comments: vi.fn(async () => ({ comments: [], total: 0, limit: 20, offset: 0, locked: false, canComment: false })),
    });
    render(
      <>
        <CommentThread itemId="9" />
        <FeedbackWidget />
      </>,
      { wrapper: wrap(api, false, false, undefined, onRequireSignIn) },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to comment" }));
    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onRequireSignIn).toHaveBeenCalledTimes(2);
    // The panel stays open (nothing typed is lost); the host's modal sits on top.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
  });

  it("refetches lists after the visitor signs in, so votes match the session", async () => {
    const api = fakeApi();
    const view = (signedIn: boolean) => (
      <ContributorProvider api={api} signedIn={signedIn} onRequireSignIn={() => undefined}>
        <ContributorBoard />
      </ContributorProvider>
    );
    const { rerender } = render(view(false));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    rerender(view(true));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});

describe("after signing in", () => {
  it("the composer switches from the guest pseudonym to the account's name", async () => {
    const { JANE } = await import("./helpers");
    let signedIn = false;
    const api = fakeApi({
      identity: vi.fn(async () =>
        signedIn
          ? { ...JANE, customName: null }
          : { ...(await import("./helpers")).makeIdentity() },
      ),
    });
    const view = () => (
      <ContributorProvider api={api} signedIn={signedIn} allowAnonymous onRequireSignIn={() => undefined}>
        <CommentThread itemId="9" />
      </ContributorProvider>
    );
    const { rerender } = render(view());
    expect(await screen.findByText("Brave Otter")).toBeTruthy();
    signedIn = true;
    rerender(view());
    expect(await screen.findByText("jane")).toBeTruthy();
    expect(screen.queryByText("Brave Otter")).toBeNull();
  });
});

describe("load more", () => {
  it("follows the server's cursor and never shows an item twice", async () => {
    const api = fakeApi({
      list: vi.fn(async (q: ListFeedbackQuery = {}) =>
        q.cursor
          ? {
              items: [makeItem({ id: "2", title: "Second" }), makeItem({ id: "3", title: "Third" })],
              total: null,
              limit: 20,
              offset: 0,
              nextCursor: null,
            }
          : { items: [makeItem({ id: "1", title: "First" }), makeItem({ id: "2", title: "Second" })], total: 3, limit: 20, offset: 0, nextCursor: "abc" },
      ),
    });
    render(<ContributorBoard />, { wrapper: wrap(api) });
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Third")).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith({ scope: "board", sort: "top", kind: undefined, limit: 20, cursor: "abc" });
    expect(screen.getAllByText("Second")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
