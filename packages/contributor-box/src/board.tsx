"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useContributor } from "./context";
import { FeedbackForm } from "./form";
import { safeHref } from "./safe-url";
import type { FeedbackItem, FeedbackKind, FeedbackNote, ListFeedbackQuery } from "./types";
import { KINDS } from "./types";
import { Button, Choice, cx, formatDate, KindBadge, StatusBadge, UpIcon } from "./ui";

const PAGE = 20;

/** Loads pages of `list(query)`; resets when the query key changes. */
export function useFeedbackList(query: ListFeedbackQuery) {
  const { api } = useContributor();
  const key = JSON.stringify(query);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(false);
      try {
        const page = await api.list({ ...(JSON.parse(key) as ListFeedbackQuery), limit: PAGE, offset });
        if (id !== requestId.current) return;
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch {
        if (id === requestId.current) setError(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [api, key],
  );

  useEffect(() => {
    // Fetch-on-change: the setState calls inside `load` sync this list with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0);
  }, [load]);

  const replace = useCallback((item: FeedbackItem) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...item } : i)));
  }, []);
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  const reload = useCallback(() => load(0), [load]);
  const loadMore = useCallback(() => load(items.length), [load, items.length]);

  return { items, total, loading, error, reload, loadMore, replace, removeItem };
}

export function VoteButton({ item, onChange }: { item: FeedbackItem; onChange: (item: FeedbackItem) => void }) {
  const { api, strings: s } = useContributor();
  const [busy, setBusy] = useState(false);
  if (!item.canVote) return null;
  return (
    <button
      type="button"
      aria-pressed={item.voted}
      aria-label={`${item.voted ? s.unvote : s.vote} (${s.votes(item.voteCount)})`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          onChange(await api.vote(item.id, !item.voted));
        } catch {
          // Leave the count unchanged; the button stays usable for another try.
        } finally {
          setBusy(false);
        }
      }}
      className={cx(
        "flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded-control px-2 text-footnote font-semibold tabular-nums transition-colors duration-150 focus-ring",
        item.voted ? "bg-tint text-on-tint" : "bg-fill-tertiary text-label hover:bg-fill-secondary",
      )}
    >
      <UpIcon size={14} />
      {item.voteCount}
    </button>
  );
}

export function NoteList({ notes }: { notes: FeedbackNote[] }) {
  const { strings: s } = useContributor();
  if (notes.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2">
      {notes.map((n) => (
        <li key={n.id} className="rounded-control bg-fill-tertiary px-3 py-2 text-subheadline">
          {n.kind === "status" && n.fromStatus && n.toStatus ? (
            <span className="text-label-secondary">
              {s.statusChange(s.status[n.fromStatus], s.status[n.toStatus])}
            </span>
          ) : (
            <span className="whitespace-pre-wrap break-words text-label">{n.body}</span>
          )}
          <span className="mt-0.5 block text-caption text-label-tertiary">
            {formatDate(n.createdAt)}
            {n.authorEmail ? ` · ${n.authorEmail}` : ""}
            {n.visibility === "internal" ? ` · ${s.visibilityInternal}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ItemCard({
  item,
  onOpen,
  onChange,
}: {
  item: FeedbackItem;
  onOpen: () => void;
  onChange: (item: FeedbackItem) => void;
}) {
  const { strings: s } = useContributor();
  return (
    <li className="flex gap-3 rounded-card border border-separator bg-grouped-secondary p-4 shadow-card">
      <VoteButton item={item} onChange={onChange} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus-ring rounded-control">
        <span className="block truncate text-headline text-label">{item.title}</span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block break-words text-subheadline text-label-secondary">
            {item.body}
          </span>
        ) : null}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <KindBadge kind={item.kind} label={s.kind[item.kind]} />
          <StatusBadge status={item.status} label={s.status[item.status]} />
          {!item.canVote ? (
            <span className="text-caption text-label-tertiary">{s.votes(item.voteCount)}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/**
 * Vote count for a viewer who cannot vote. Signed out (and a sign-in link configured): a pill
 * linking to sign-in, so the count doubles as the "sign in to vote" hint. Otherwise plain text.
 */
export function VoteCount({ item }: { item: FeedbackItem }) {
  const { strings: s, signedIn, signInHref, linkAs: Link } = useContributor();
  if (!signedIn && signInHref) {
    return (
      <Link
        href={signInHref}
        className="flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center rounded-control bg-fill-tertiary px-2 text-footnote font-semibold text-label-secondary tabular-nums transition-colors duration-150 hover:bg-fill-secondary focus-ring"
      >
        <span className="sr-only">{`${s.signInToVote} (${s.votes(item.voteCount)})`}</span>
        <span aria-hidden="true" className="flex flex-col items-center" title={s.signInToVote}>
          <UpIcon size={14} />
          {item.voteCount}
        </span>
      </Link>
    );
  }
  return <span className="shrink-0 text-caption text-label-tertiary tabular-nums">{s.votes(item.voteCount)}</span>;
}

/** Detail of one item (body, team reply, public history; context for the author and admins). */
export function ItemDetail({
  id,
  onBack,
  onChange,
  onDeleted,
  backLabel,
}: {
  id: string;
  onBack: () => void;
  onChange: (item: FeedbackItem) => void;
  onDeleted: (id: string) => void;
  /** Label of the button that calls `onBack`. Default "‹ Back". */
  backLabel?: string;
}) {
  const { api, strings: s, signedIn } = useContributor();
  const [item, setItem] = useState<FeedbackItem | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(id).then(
      (v) => alive && setItem(v),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [api, id]);

  const update = (next: FeedbackItem) => {
    setItem((prev) => (prev ? { ...prev, ...next, notes: prev.notes } : next));
    onChange(next);
  };

  const href = safeHref(item?.context?.pageUrl);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="plain" onClick={onBack}>
          {backLabel ?? `‹ ${s.back}`}
        </Button>
      </div>
      {error ? <p role="alert" className="text-subheadline text-danger">{s.errorGeneric}</p> : null}
      {!item && !error ? <p className="text-subheadline text-label-secondary">{s.loading}</p> : null}
      {item ? (
        <article className="flex flex-col gap-4 rounded-card border border-separator bg-grouped-secondary p-4 shadow-card">
          <div className="flex items-start gap-3">
            <VoteButton item={item} onChange={update} />
            {/* Signed out on a public item: the count, linking to sign-in. */}
            {!item.canVote && !signedIn ? <VoteCount item={item} /> : null}
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-title3 text-label">{item.title}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <KindBadge kind={item.kind} label={s.kind[item.kind]} />
                <StatusBadge status={item.status} label={s.status[item.status]} />
                <span className="text-caption text-label-tertiary">{formatDate(item.createdAt)}</span>
              </div>
            </div>
          </div>
          {item.body ? <p className="whitespace-pre-wrap break-words text-body text-label">{item.body}</p> : null}
          {item.adminResponse ? (
            <div className="rounded-control bg-tint-soft px-3 py-2">
              <p className="text-footnote font-semibold text-tint-ink">{s.teamReply}</p>
              <p className="whitespace-pre-wrap break-words text-subheadline text-label">{item.adminResponse}</p>
            </div>
          ) : null}
          {item.context ? (
            <div className="text-footnote text-label-secondary">
              {s.pageLabel}:{" "}
              {href ? (
                <a href={href} className="break-all text-tint underline" rel="noopener noreferrer nofollow">
                  {item.context.pageTitle || item.context.pageUrl}
                </a>
              ) : (
                <span className="break-all">{item.context.pageUrl}</span>
              )}
              {item.context.hasScreenshot ? (
                // Same-origin, cookie-authenticated image endpoint (author or admin only).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={api.screenshotUrl(item.id)}
                  alt={s.screenshotAlt}
                  loading="lazy"
                  className="mt-2 max-h-80 w-full rounded-control border border-separator object-contain object-top"
                />
              ) : null}
            </div>
          ) : null}
          {item.notes && item.notes.length > 0 ? (
            <div>
              <h3 className="mb-2 text-footnote font-semibold text-label-secondary">{s.history}</h3>
              <NoteList notes={item.notes} />
            </div>
          ) : null}
          {item.canDelete ? (
            <div>
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  if (!window.confirm(s.deleteConfirm)) return;
                  try {
                    await api.remove(item.id);
                    onDeleted(item.id);
                  } catch {
                    setError(true);
                  }
                }}
              >
                {s.deleteItem}
              </Button>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

/**
 * The Contributor screen: the public ideas board (approved / planned / done, with votes), the
 * signed-in user's own submissions with their status, and a form to suggest a new idea.
 */
export function ContributorBoard() {
  const { strings: s } = useContributor();
  const [tab, setTab] = useState<"board" | "mine">("board");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [kind, setKind] = useState<FeedbackKind | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const list = useFeedbackList({
    scope: tab,
    sort: tab === "board" ? sort : "new",
    kind: kind === "all" ? undefined : kind,
  });

  if (openId) {
    return (
      <ItemDetail
        id={openId}
        onBack={() => setOpenId(null)}
        onChange={list.replace}
        onDeleted={(id) => {
          list.removeItem(id);
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Choice
          name="contrib-tab"
          label={s.boardTitle}
          value={tab}
          onChange={setTab}
          options={[
            { value: "board", label: s.tabBoard },
            { value: "mine", label: s.tabMine },
          ]}
        />
        <Button variant="filled" size="sm" onClick={() => setComposing((v) => !v)} aria-expanded={composing}>
          {s.newIdea}
        </Button>
      </div>
      {composing ? (
        <div className="rounded-card border border-separator bg-grouped-secondary p-4 shadow-card">
          <FeedbackForm
            defaultKind="idea"
            withPageContext={false}
            onSubmitted={() => {
              setComposing(false);
              setTab("mine");
              void list.reload();
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {tab === "board" ? (
          <Choice
            name="contrib-sort"
            label={s.sortTop}
            value={sort}
            onChange={setSort}
            options={[
              { value: "top", label: s.sortTop },
              { value: "new", label: s.sortNew },
            ]}
          />
        ) : null}
        <select
          aria-label={s.kindLabel}
          value={kind}
          onChange={(e) => setKind(e.target.value as FeedbackKind | "all")}
          className="min-h-8 rounded-control border border-control-border bg-background px-2 text-footnote text-label focus-ring"
        >
          <option value="all">{s.allKinds}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {s.kind[k]}
            </option>
          ))}
        </select>
      </div>

      <div aria-busy={list.loading} aria-live="polite">
        {list.error ? (
          <div role="alert" className="rounded-card bg-danger-soft p-4 text-subheadline text-danger-ink">
            {s.errorGeneric}{" "}
            <button type="button" className="underline" onClick={() => void list.reload()}>
              {s.retry}
            </button>
          </div>
        ) : null}
        {!list.loading && !list.error && list.items.length === 0 ? (
          <p className="rounded-card bg-grouped-secondary p-6 text-center text-subheadline text-label-secondary">
            {tab === "board" ? s.emptyBoard : s.emptyMine}
          </p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {list.items.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} onChange={list.replace} />
          ))}
        </ul>
        {list.loading ? <p className="py-4 text-center text-footnote text-label-tertiary">{s.loading}</p> : null}
        {!list.loading && list.items.length < list.total ? (
          <div className="pt-3 text-center">
            <Button variant="gray" onClick={() => void list.loadMore()}>
              {s.loadMore}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
