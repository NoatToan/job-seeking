"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { SignInAction, useCanAskToSignIn, useContributor } from "./context";
import type { CommentPage, FeedbackComment, FeedbackIdentity, VoteValue } from "./types";
import {
  AuthorName,
  Avatar,
  Button,
  cx,
  displayName,
  formatDate,
  inputClasses,
  LinkifiedText,
  relativeTime,
  VoteControl,
} from "./ui";

const PAGE = 20;
const COMMENT_MAX = 2000;

function errorStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status: unknown }).status)
    : undefined;
}

function mergeById(prev: FeedbackComment[], next: FeedbackComment[]): FeedbackComment[] {
  const seen = new Set(prev.map((c) => c.id));
  return [...prev, ...next.filter((c) => !seen.has(c.id))];
}

/** "You'll appear as 🦦 Brave Otter · Change", with an inline editor for the display name. */
export function IdentityLine({
  identity,
  onChange,
}: {
  identity: FeedbackIdentity;
  onChange: (identity: FeedbackIdentity) => void;
}) {
  const { api, strings: s } = useContributor();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity.customName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const save = async (value: string | null) => {
    setBusy(true);
    setError(false);
    try {
      onChange(await api.setDisplayName(value));
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-footnote text-label-secondary">
        <Avatar author={identity} size={20} />
        <span>{s.youAppearAs}</span>
        <AuthorName author={identity} />
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="rounded-sm font-medium text-tint hover:underline focus-ring"
          onClick={() => {
            setName(identity.customName ?? "");
            setEditing(true);
          }}
          aria-label={`${s.changeName}: ${s.displayNameLabel}`}
        >
          {s.changeName}
        </button>
      </p>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5 rounded-control bg-fill-tertiary p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save(name.trim() || null);
      }}
    >
      <label htmlFor={`${uid}-name`} className="text-footnote font-medium text-label-secondary">
        {s.displayNameLabel}
      </label>
      <input
        id={`${uid}-name`}
        className={inputClasses}
        value={name}
        maxLength={40}
        autoComplete="nickname"
        placeholder={displayName({ ...identity, name: null }, s.locale) || undefined}
        aria-describedby={`${uid}-hint`}
        aria-invalid={error || undefined}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <p id={`${uid}-hint`} className={cx("text-caption", error ? "text-danger" : "text-label-tertiary")} role={error ? "alert" : undefined}>
        {error ? s.nameRejected : s.displayNameHint}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="tinted" disabled={busy}>
          {s.save}
        </Button>
        {identity.customName ? (
          <Button size="sm" variant="plain" disabled={busy} onClick={() => void save(null)}>
            {s.useGeneratedName}
          </Button>
        ) : null}
        <Button size="sm" variant="plain" disabled={busy} onClick={() => setEditing(false)}>
          {s.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Text box for a new comment or reply. Includes a honeypot field real people never see. */
function Composer({
  itemId,
  parentId,
  initialText = "",
  identity,
  onIdentityChange,
  onPosted,
  onCancel,
  autoFocus,
}: {
  itemId: string;
  parentId?: string;
  initialText?: string;
  identity: FeedbackIdentity | null;
  onIdentityChange: (identity: FeedbackIdentity) => void;
  onPosted: (comment: FeedbackComment) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const { api, strings: s } = useContributor();
  const uid = useId();
  const [text, setText] = useState(initialText);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const reply = Boolean(parentId);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const posted = await api.addComment(itemId, {
        body,
        ...(parentId ? { parentId } : {}),
        ...(website ? { website } : {}),
      });
      setText("");
      onPosted(posted);
    } catch (err) {
      const status = errorStatus(err);
      setError(status === 429 ? s.commentRateLimited : status === 409 ? s.commentsLocked : s.commentError);
    } finally {
      setBusy(false);
    }
  };

  const left = COMMENT_MAX - text.length;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      {identity ? <IdentityLine identity={identity} onChange={onIdentityChange} /> : null}
      <label htmlFor={`${uid}-body`} className="sr-only">
        {reply ? s.replyLabel : s.commentLabel}
      </label>
      <textarea
        id={`${uid}-body`}
        ref={ref}
        rows={reply ? 2 : 3}
        className={cx(inputClasses, "block min-h-16 resize-y")}
        value={text}
        maxLength={COMMENT_MAX}
        placeholder={reply ? s.replyPlaceholder : s.commentPlaceholder}
        aria-describedby={left < 200 ? `${uid}-left` : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      {/* Honeypot: off-screen, out of the tab order and the accessibility tree. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input
          id={`${uid}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-footnote text-danger-ink">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="filled" disabled={busy || !text.trim()}>
          {busy ? s.posting : reply ? s.postReply : s.postComment}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="plain" onClick={onCancel} disabled={busy}>
            {s.cancel}
          </Button>
        ) : null}
        {left < 200 ? (
          <span id={`${uid}-left`} className="ml-auto text-caption text-label-tertiary tabular-nums">
            {s.charsLeft(left)}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** One comment (top-level or reply): author, text, votes and actions. */
function CommentView({
  itemId,
  comment,
  onChange,
  onRemoved,
  onReply,
}: {
  itemId: string;
  comment: FeedbackComment;
  onChange: (comment: FeedbackComment) => void;
  /** The comment is gone from the thread (hard delete). */
  onRemoved: () => void;
  onReply?: () => void;
}) {
  const { api, strings: s } = useContributor();
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? "");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const placeholder = comment.body === null;
  const when = relativeTime(comment.createdAt, s.locale);

  return (
    <article className="flex gap-2.5" aria-labelledby={`${uid}-who`}>
      {placeholder || !comment.author ? (
        <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-fill-tertiary" />
      ) : (
        <Avatar author={comment.author} />
      )}
      <div className="min-w-0 flex-1">
        <header id={`${uid}-who`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote">
          {placeholder || !comment.author ? (
            <span className="italic text-label-tertiary">{comment.deleted ? s.deletedComment : s.removedComment}</span>
          ) : (
            <AuthorName author={comment.author} isMine={comment.isMine} />
          )}
          <time dateTime={comment.createdAt} title={formatDate(comment.createdAt, s.locale)} className="text-caption text-label-tertiary">
            {when}
          </time>
          {comment.editedAt && !placeholder ? (
            <span className="text-caption text-label-tertiary" title={formatDate(comment.editedAt, s.locale)}>
              · {s.edited}
            </span>
          ) : null}
          {comment.hidden && !placeholder ? (
            <span className="rounded-full bg-warning-soft px-1.5 text-caption font-medium text-warning-ink">{s.hiddenBadge}</span>
          ) : null}
          {comment.reportCount ? (
            <span className="rounded-full bg-danger-soft px-1.5 text-caption font-medium text-danger-ink">
              {s.reportsCount(comment.reportCount)}
            </span>
          ) : null}
        </header>

        {editing ? (
          <form
            className="mt-1.5 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = draft.trim();
              if (!body) return;
              void run(async () => {
                onChange(await api.editComment(itemId, comment.id, body));
                setEditing(false);
              });
            }}
          >
            <label htmlFor={`${uid}-edit`} className="sr-only">
              {s.editComment}
            </label>
            <textarea
              id={`${uid}-edit`}
              className={cx(inputClasses, "block min-h-16 resize-y")}
              value={draft}
              maxLength={COMMENT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="tinted" disabled={busy || !draft.trim()}>
                {s.save}
              </Button>
              <Button size="sm" variant="plain" disabled={busy} onClick={() => setEditing(false)}>
                {s.cancel}
              </Button>
            </div>
          </form>
        ) : placeholder ? null : (
          <LinkifiedText text={comment.body ?? ""} className="mt-0.5 text-subheadline text-label" />
        )}

        {!placeholder && !editing ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <VoteControl
              size="sm"
              score={comment.score}
              myVote={comment.myVote}
              canVote={comment.canVote}
              label={displayName(comment.author, s.locale)}
              onVote={async (value: VoteValue) => onChange(await api.voteComment(itemId, comment.id, value))}
              horizontal
            />
            {comment.canReply && onReply ? (
              <Button size="sm" variant="plain" onClick={onReply}>
                {s.reply}
              </Button>
            ) : null}
            {comment.canEdit ? (
              <Button
                size="sm"
                variant="plain"
                onClick={() => {
                  setDraft(comment.body ?? "");
                  setEditing(true);
                }}
              >
                {s.editComment}
              </Button>
            ) : null}
            {comment.canDelete ? (
              <Button
                size="sm"
                variant="plain"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(s.deleteCommentConfirm)) return;
                  void run(async () => {
                    const result = await api.deleteComment(itemId, comment.id);
                    if (result.comment) onChange(result.comment);
                    else onRemoved();
                  });
                }}
              >
                {s.deleteComment}
              </Button>
            ) : null}
            {comment.canReport && !reported ? (
              <Button size="sm" variant="plain" aria-expanded={reporting} onClick={() => setReporting((v) => !v)}>
                {s.report}
              </Button>
            ) : null}
            {comment.canModerate ? (
              <>
                <Button
                  size="sm"
                  variant="plain"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => onChange(await api.setCommentHidden(itemId, comment.id, !comment.hidden)))
                  }
                >
                  {comment.hidden ? s.unhide : s.hide}
                </Button>
                {comment.reportCount ? (
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.dismissReports(itemId, comment.id);
                        onChange({ ...comment, reportCount: 0 });
                      })
                    }
                  >
                    {s.dismissReports}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {reporting ? (
          <form
            className="mt-1.5 flex flex-col gap-2 rounded-control bg-fill-tertiary p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.reportComment(itemId, comment.id, reason.trim() || null);
                setReporting(false);
                setReported(true);
              });
            }}
          >
            <label htmlFor={`${uid}-reason`} className="text-footnote text-label-secondary">
              {s.reportPrompt}
            </label>
            <input
              id={`${uid}-reason`}
              className={inputClasses}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={busy}>
                {s.report}
              </Button>
              <Button size="sm" variant="plain" onClick={() => setReporting(false)}>
                {s.cancel}
              </Button>
            </div>
          </form>
        ) : null}
        {reported ? (
          <p role="status" className="mt-1 text-caption text-label-secondary">
            {s.reported}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1 text-caption text-danger">
            {s.errorGeneric}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** A top-level comment, its replies ("show more replies") and the reply composer. */
function Thread({
  itemId,
  top,
  identity,
  onIdentityChange,
  onChange,
  onRemoved,
  onCount,
}: {
  itemId: string;
  top: FeedbackComment;
  identity: FeedbackIdentity | null;
  onIdentityChange: (identity: FeedbackIdentity) => void;
  onChange: (comment: FeedbackComment) => void;
  onRemoved: () => void;
  onCount: (delta: number) => void;
}) {
  const { api, strings: s } = useContributor();
  const [replying, setReplying] = useState<{ mention: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const replies = top.replies ?? [];
  const hidden = Math.max(0, (top.replyCount ?? 0) - replies.length);

  const setReplies = (next: FeedbackComment[], countDelta = 0) =>
    onChange({ ...top, replies: next, replyCount: Math.max(0, (top.replyCount ?? 0) + countDelta) });

  const showMore = async () => {
    setLoadingMore(true);
    try {
      const page = await api.replies(itemId, top.id, { offset: replies.length, limit: 50 });
      onChange({ ...top, replies: mergeById(replies, page.replies), replyCount: page.total });
    } catch {
      // The button stays; the next click retries.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <li className="flex flex-col gap-3">
      <CommentView
        itemId={itemId}
        comment={top}
        onChange={(c) => onChange({ ...c, replies, replyCount: top.replyCount })}
        onRemoved={onRemoved}
        onReply={() => setReplying({ mention: "" })}
      />
      {replies.length > 0 || hidden > 0 || replying ? (
        <div className="ml-5 flex flex-col gap-3 border-l-2 border-separator pl-4 sm:ml-10">
          {replies.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {replies.map((reply) => (
                <li key={reply.id}>
                  <CommentView
                    itemId={itemId}
                    comment={reply}
                    onChange={(c) => setReplies(replies.map((r) => (r.id === c.id ? c : r)))}
                    onRemoved={() => {
                      setReplies(
                        replies.filter((r) => r.id !== reply.id),
                        -1,
                      );
                      onCount(-1);
                    }}
                    onReply={() => {
                      const name = displayName(reply.author, s.locale);
                      setReplying({ mention: name ? `@${name} ` : "" });
                    }}
                  />
                </li>
              ))}
            </ol>
          ) : null}
          {hidden > 0 ? (
            <div>
              <Button size="sm" variant="plain" disabled={loadingMore} onClick={() => void showMore()}>
                {loadingMore ? s.loading : s.showMoreReplies(hidden)}
              </Button>
            </div>
          ) : null}
          {replying ? (
            <Composer
              key={replying.mention}
              itemId={itemId}
              parentId={top.id}
              initialText={replying.mention}
              identity={identity}
              onIdentityChange={onIdentityChange}
              autoFocus
              onCancel={() => setReplying(null)}
              onPosted={(posted) => {
                setReplying(null);
                setReplies(mergeById(replies, [posted]), 1);
                onCount(1);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Comments under an item: top-level comments (best score first, then newest) with replies
 * (oldest first), a composer, votes, edit / delete within the server's window, reporting, and
 * moderation for admins. Signed-out visitors comment under their pseudonym when the server allows
 * it (`allow_anonymous_comments`), otherwise they get a sign-in link.
 */
export function CommentThread({
  itemId,
  onCountChange,
}: {
  itemId: string;
  /** Called with +1 / -1 when the visible comment count changes (to update cards). */
  onCountChange?: (delta: number) => void;
}) {
  const { api, strings: s, signedIn } = useContributor();
  const canAskToSignIn = useCanAskToSignIn();
  const headingId = useId();
  const [page, setPage] = useState<Omit<CommentPage, "comments"> | null>(null);
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [identity, setIdentity] = useState<FeedbackIdentity | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(false);
      try {
        const next = await api.comments(itemId, { offset, limit: PAGE });
        if (id !== requestId.current) return;
        const { comments: rows, ...meta } = next;
        setPage(meta);
        setComments((prev) => (offset === 0 ? rows : mergeById(prev, rows)));
      } catch {
        if (id === requestId.current) setError(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    // `signedIn`: reload after an in-place sign-in so votes and actions match the session.
    [api, itemId, signedIn],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0);
  }, [load]);

  // Who the composer will post as (for a guest this also issues the visitor cookie).
  const canComment = page?.canComment ?? false;
  useEffect(() => {
    if (!canComment) return;
    let alive = true;
    api.identity().then(
      (v) => alive && setIdentity(v),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, canComment, signedIn]);

  // Replies change the item's comment count, not the number of top-level threads.
  const count = (delta: number) => onCountChange?.(delta);

  const replaceTop = (next: FeedbackComment) => setComments((prev) => prev.map((c) => (c.id === next.id ? next : c)));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h3 id={headingId} className="text-headline text-label">
        {s.comments}
        {page && page.total > 0 ? <>{" "}<span className="text-label-tertiary">({page.total})</span></> : null}
      </h3>

      {page?.canComment ? (
        <Composer
          itemId={itemId}
          identity={identity}
          onIdentityChange={setIdentity}
          onPosted={(posted) => {
            setComments((prev) => [{ ...posted, replies: [], replyCount: 0 }, ...prev]);
            setPage((p) => (p ? { ...p, total: p.total + 1 } : p));
            onCountChange?.(1);
          }}
        />
      ) : page?.locked ? (
        <p className="rounded-control bg-fill-tertiary px-3 py-2 text-footnote text-label-secondary">{s.commentsLocked}</p>
      ) : page && !signedIn && canAskToSignIn ? (
        <SignInAction
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-control bg-tint-soft px-4 text-subheadline font-semibold text-tint-ink focus-ring"
        >
          {s.signInToComment}
        </SignInAction>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-control bg-danger-soft p-3 text-footnote text-danger-ink">
          {s.loadError}{" "}
          <button type="button" className="underline focus-ring" onClick={() => void load(0)}>
            {s.retry}
          </button>
        </div>
      ) : null}
      {!loading && !error && comments.length === 0 ? (
        <p className="rounded-control border border-dashed border-separator p-4 text-center text-footnote text-label-secondary">
          {s.commentsEmpty}
        </p>
      ) : null}
      {comments.length > 0 ? (
        <ol className="flex flex-col gap-5" aria-busy={loading}>
          {comments.map((top) => (
            <Thread
              key={top.id}
              itemId={itemId}
              top={top}
              identity={identity}
              onIdentityChange={setIdentity}
              onChange={replaceTop}
              onCount={count}
              onRemoved={() => {
                setComments((prev) => prev.filter((c) => c.id !== top.id));
                setPage((p) => (p ? { ...p, total: Math.max(0, p.total - 1) } : p));
                onCountChange?.(-1);
              }}
            />
          ))}
        </ol>
      ) : null}
      {loading ? <p className="text-center text-footnote text-label-tertiary">{s.loading}</p> : null}
      {!loading && page && comments.length < page.total ? (
        <div>
          <Button size="sm" variant="gray" onClick={() => void load(comments.length)}>
            {s.showMoreComments}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
