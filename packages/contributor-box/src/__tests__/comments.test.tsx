import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentThread } from "../comments";
import { strings } from "../strings";
import type { CommentPage } from "../types";
import { GUEST, JANE, fakeApi, makeComment, wrap } from "./helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function page(overrides: Partial<CommentPage> = {}): CommentPage {
  return { comments: [], total: 0, limit: 20, offset: 0, locked: false, canComment: true, ...overrides };
}

const top = makeComment({
  id: "c1",
  body: "Works for me, see https://example.com/docs.",
  score: 4,
  replyCount: 5,
  replies: [
    makeComment({ id: "r1", parentId: "c1", body: "First reply", author: GUEST, canVote: false }),
    makeComment({ id: "r2", parentId: "c1", body: "Second reply" }),
  ],
});

describe("CommentThread", () => {
  it("renders threads with replies, safe links and 'show more replies'", async () => {
    const api = fakeApi({
      comments: vi.fn(async () => page({ comments: [top], total: 1 })),
      replies: vi.fn(async () => ({
        replies: [makeComment({ id: "r3", parentId: "c1", body: "Third reply" })],
        total: 5,
        limit: 50,
        offset: 2,
      })),
    });
    const { container } = render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    expect(await screen.findByText("First reply")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comments (1)" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "https://example.com/docs" });
    expect(link.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(container.textContent).toContain("/docs.");
    // A guest reply shows the pseudonym and its tag.
    const guestReply = within(screen.getByText("First reply").closest("article")!);
    expect(guestReply.getByText("Brave Otter")).toBeTruthy();
    expect(guestReply.getByText("Guest #123")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more replies" }));
    expect(await screen.findByText("Third reply")).toBeTruthy();
    expect(api.replies).toHaveBeenCalledWith("9", "c1", { offset: 2, limit: 50 });
    expect(screen.getByRole("button", { name: "Show 2 more replies" })).toBeTruthy();
  });

  it("posts a comment and counts it", async () => {
    const onCountChange = vi.fn();
    const api = fakeApi({ identity: vi.fn(async () => ({ ...JANE, customName: null })) });
    render(<CommentThread itemId="9" onCountChange={onCountChange} />, { wrapper: wrap(api) });
    expect(await screen.findByText("No comments yet. Add yours to make this idea better.")).toBeTruthy();
    expect(await screen.findByText("You'll appear as")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "  Love it  " } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith("9", { body: "Love it" }));
    expect(await screen.findByText("Love it")).toBeTruthy();
    expect(onCountChange).toHaveBeenCalledWith(1);
    expect((screen.getByLabelText("Your comment") as HTMLTextAreaElement).value).toBe("");
  });

  it("replies to a reply in the same thread with an @mention", async () => {
    const api = fakeApi({ comments: vi.fn(async () => page({ comments: [top], total: 1 })) });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByText("First reply");
    const firstReply = screen.getByText("First reply").closest("article")!;
    fireEvent.click(within(firstReply).getByRole("button", { name: "Reply" }));
    const box = screen.getByLabelText("Your reply") as HTMLTextAreaElement;
    expect(box.value).toBe("@Brave Otter ");
    fireEvent.change(box, { target: { value: "@Brave Otter agreed" } });
    fireEvent.click(within(box.closest("form")!).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(api.addComment).toHaveBeenCalledWith("9", { body: "@Brave Otter agreed", parentId: "c1" }));
    expect(await screen.findByText("@Brave Otter agreed")).toBeTruthy();
  });

  it("sends the honeypot only when something filled it", async () => {
    const api = fakeApi();
    const { container } = render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByLabelText("Your comment");
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest("[aria-hidden='true']")).toBeTruthy();
    fireEvent.change(trap, { target: { value: "http://spam.example" } });
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "buy now" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(api.addComment).toHaveBeenCalledWith("9", { body: "buy now", website: "http://spam.example" }),
    );
  });

  it("guests see their pseudonym before posting, in their language", async () => {
    const api = fakeApi();
    render(<CommentThread itemId="9" />, { wrapper: wrap(api, false, true, strings.vi) });
    expect(await screen.findByText("Bạn sẽ hiển thị là")).toBeTruthy();
    expect(screen.getByText("Rái cá dũng cảm")).toBeTruthy();
    expect(api.identity).toHaveBeenCalled();
  });

  it("signed out without anonymous comments: a sign-in link, no composer, no identity call", async () => {
    const api = fakeApi({ comments: vi.fn(async () => page({ canComment: false })) });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api, false) });
    const link = await screen.findByRole("link", { name: "Sign in to comment" });
    expect(link.getAttribute("href")).toBe("/login/");
    expect(screen.queryByLabelText("Your comment")).toBeNull();
    expect(api.identity).not.toHaveBeenCalled();
  });

  it("says when comments are locked", async () => {
    const api = fakeApi({ comments: vi.fn(async () => page({ locked: true, canComment: false })) });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    expect(await screen.findByText("Comments are locked on this item.")).toBeTruthy();
  });

  it("shows deleted and removed placeholders", async () => {
    const api = fakeApi({
      comments: vi.fn(async () =>
        page({
          total: 2,
          comments: [
            makeComment({ id: "d1", body: null, deleted: true, author: null, canReply: false, replies: [makeComment({ id: "x", parentId: "d1", body: "kept" })], replyCount: 1 }),
            makeComment({ id: "h1", body: null, hidden: true, author: null, canReply: false, replies: [makeComment({ id: "y", parentId: "h1", body: "also kept" })], replyCount: 1 }),
          ],
        }),
      ),
    });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    expect(await screen.findByText("[deleted]")).toBeTruthy();
    expect(screen.getByText("[removed by a moderator]")).toBeTruthy();
    expect(screen.getByText("kept")).toBeTruthy();
  });

  it("votes on a comment optimistically and rolls back on failure", async () => {
    const api = fakeApi({
      comments: vi.fn(async () => page({ comments: [makeComment({ id: "c1", body: "Nice", score: 4 })], total: 1 })),
      voteComment: vi.fn(async () => Promise.reject(new Error("offline"))),
    });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByText("Nice");
    fireEvent.click(screen.getByRole("button", { name: "Upvote: jane" }));
    await waitFor(() => expect(api.voteComment).toHaveBeenCalledWith("9", "c1", 1));
    await waitFor(() => expect(screen.getByRole("group", { name: "Score 4: jane" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Upvote: jane" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("edits and deletes your own comment", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onCountChange = vi.fn();
    const mine = makeComment({ id: "m1", body: "tpyo", isMine: true, canEdit: true, canDelete: true, canVote: false, canReport: false });
    const api = fakeApi({ comments: vi.fn(async () => page({ comments: [mine], total: 1 })) });
    render(<CommentThread itemId="9" onCountChange={onCountChange} />, { wrapper: wrap(api) });
    await screen.findByText("tpyo");
    expect(screen.getByText("· You")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit"), { target: { value: "typo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.editComment).toHaveBeenCalledWith("9", "m1", "typo"));
    expect(await screen.findByText("typo")).toBeTruthy();
    expect(screen.getByText("· edited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteComment).toHaveBeenCalledWith("9", "m1"));
    await waitFor(() => expect(screen.queryByText("typo")).toBeNull());
    expect(onCountChange).toHaveBeenCalledWith(-1);
  });

  it("reports a comment with an optional reason", async () => {
    const api = fakeApi({ comments: vi.fn(async () => page({ comments: [makeComment({ id: "c1", body: "rude" })], total: 1 })) });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByText("rude");
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.change(screen.getByLabelText(/Why should a moderator/), { target: { value: "Insults" } });
    const form = screen.getByLabelText(/Why should a moderator/).closest("form")!;
    fireEvent.click(within(form).getByRole("button", { name: "Report" }));
    await waitFor(() => expect(api.reportComment).toHaveBeenCalledWith("9", "c1", "Insults"));
    expect(await screen.findByText("Reported. A moderator will take a look.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("lets admins hide and see report counts", async () => {
    const api = fakeApi({
      comments: vi.fn(async () =>
        page({ comments: [makeComment({ id: "c1", body: "spam", canModerate: true, canReport: false, reportCount: 2 })], total: 1 }),
      ),
    });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByText("spam");
    expect(screen.getByText("2 reports")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(api.setCommentHidden).toHaveBeenCalledWith("9", "c1", true));
    expect(await screen.findByText("Hidden")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unhide" })).toBeTruthy();
  });

  it("shows a friendly message when rate limited", async () => {
    const err = Object.assign(new Error("rate"), { status: 429 });
    const api = fakeApi({ addComment: vi.fn(async () => Promise.reject(err)) });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    fireEvent.change(await screen.findByLabelText("Your comment"), { target: { value: "again" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/a lot this hour/);
  });

  it("pages top-level comments", async () => {
    const api = fakeApi({
      comments: vi.fn(async (_id: string, q?: { offset?: number }) =>
        q?.offset
          ? page({ comments: [makeComment({ id: "c2", body: "Older" })], total: 2, offset: 1 })
          : page({ comments: [makeComment({ id: "c1", body: "Newer" })], total: 2 }),
      ),
    });
    render(<CommentThread itemId="9" />, { wrapper: wrap(api) });
    await screen.findByText("Newer");
    fireEvent.click(screen.getByRole("button", { name: "Show more comments" }));
    expect(await screen.findByText("Older")).toBeTruthy();
    expect(api.comments).toHaveBeenLastCalledWith("9", { offset: 1, limit: 20 });
    expect(screen.queryByRole("button", { name: "Show more comments" })).toBeNull();
  });
});
