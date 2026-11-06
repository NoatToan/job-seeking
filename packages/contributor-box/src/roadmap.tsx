"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ItemDetail, useFeedbackList, VoteButton, VoteCount } from "./board";
import { useContributor } from "./context";
import type { FeedbackItem, FeedbackStats, RoadmapStatus } from "./types";
import { ROADMAP_STATUSES } from "./types";
import { Button, formatDate, KindBadge, relativeTime, StatusBadge } from "./ui";
import { openFeedbackWidget } from "./widget";

export interface RoadmapProps {
  /**
   * What "Suggest an idea" does. Default: opens the mounted `FeedbackWidget` with "Feature idea"
   * preselected (`openFeedbackWidget({ kind: "idea" })`). `false` hides the button.
   */
  onSuggest?: (() => void) | false;
}

/** Done shows the newest first; the open columns show what people want most first. */
const SORT: Record<RoadmapStatus, "top" | "new"> = { approved: "top", planned: "top", done: "new" };

function RoadmapCard({
  item,
  onOpen,
  onChange,
}: {
  item: FeedbackItem;
  onOpen: (trigger: HTMLElement) => void;
  onChange: (item: FeedbackItem) => void;
}) {
  const { strings: s } = useContributor();
  const when = item.statusChangedAt ?? item.createdAt;
  return (
    <li className="flex items-start gap-3 rounded-card border border-separator bg-grouped-secondary p-3 shadow-card">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => onOpen(e.currentTarget)}
          className="block w-full rounded-control text-left focus-ring"
        >
          <KindBadge kind={item.kind} label={s.kind[item.kind]} />
          <span className="mt-1.5 line-clamp-3 block break-words text-headline text-label">{item.title}</span>
        </button>
        {item.adminResponse ? (
          <p className="mt-2 line-clamp-2 break-words rounded-control bg-tint-soft px-2 py-1 text-footnote text-label">
            <span className="font-semibold text-tint-ink">{s.teamReplyShort}: </span>
            {item.adminResponse}
          </p>
        ) : null}
        {when ? (
          <time dateTime={when} title={formatDate(when, s.locale)} className="mt-2 block text-caption text-label-tertiary">
            {relativeTime(when, s.locale)}
          </time>
        ) : null}
      </div>
      {item.canVote ? <VoteButton item={item} onChange={onChange} /> : <VoteCount item={item} />}
    </li>
  );
}

function Column({
  status,
  list,
  onOpen,
}: {
  status: RoadmapStatus;
  list: ReturnType<typeof useFeedbackList>;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  const { strings: s } = useContributor();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={list.loading}
      className="flex w-[85%] max-w-sm shrink-0 snap-start flex-col gap-3 rounded-card bg-fill-tertiary p-3 sm:w-80 md:w-auto md:max-w-none md:shrink"
    >
      <header className="flex flex-col gap-1 px-1">
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="text-headline text-label">
            {s.roadmapColumn[status]}
          </h2>
          <StatusBadge status={status} label={String(list.total)} />
        </div>
        <p className="text-footnote text-label-secondary">{s.roadmapColumnHint[status]}</p>
      </header>
      {list.error ? (
        <div role="alert" className="rounded-control bg-danger-soft p-3 text-footnote text-danger-ink">
          {s.loadError}{" "}
          <button type="button" className="underline focus-ring" onClick={() => void list.reload()}>
            {s.retry}
          </button>
        </div>
      ) : null}
      {!list.loading && !list.error && list.items.length === 0 ? (
        <p className="rounded-control border border-dashed border-separator p-4 text-center text-footnote text-label-secondary">
          {s.roadmapEmpty[status]}
        </p>
      ) : null}
      {list.items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.items.map((item) => (
            <RoadmapCard
              key={item.id}
              item={item}
              onOpen={(trigger) => onOpen(item.id, trigger)}
              onChange={list.replace}
            />
          ))}
        </ul>
      ) : null}
      {list.loading ? <p className="py-2 text-center text-footnote text-label-tertiary">{s.loading}</p> : null}
      {!list.loading && list.items.length < list.total ? (
        <Button variant="gray" size="sm" onClick={() => void list.loadMore()}>
          {s.loadMore}
        </Button>
      ) : null}
    </section>
  );
}

/** Modal around `ItemDetail`: Escape or the close button closes it and returns focus. */
function DetailDialog({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange: (item: FeedbackItem) => void;
}) {
  const { strings: s } = useContributor();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-scrim sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={s.roadmapTitle}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-sheet bg-grouped p-4 shadow-overlay outline-none animate-pop-in sm:max-w-xl sm:rounded-sheet"
      >
        <ItemDetail id={id} onBack={onClose} onChange={onChange} onDeleted={onClose} backLabel={s.close} />
      </div>
    </div>
  );
}

/**
 * Public roadmap: one column per public status (under consideration = `approved`, `planned`,
 * `done`), each sorted like the board, with vote buttons for signed-in users and a sign-in hint
 * for everyone else. Columns sit side by side from `md`, and scroll horizontally with snapping on
 * phones. A card opens the item's detail in a dialog.
 *
 * Signed-out visitors need the server's `public_board=True`; private statuses (`new`,
 * `under_review`, `rejected`) never appear here.
 */
export function Roadmap({ onSuggest }: RoadmapProps = {}) {
  const { api, strings: s } = useContributor();
  const approved = useFeedbackList({ scope: "board", status: "approved", sort: SORT.approved });
  const planned = useFeedbackList({ scope: "board", status: "planned", sort: SORT.planned });
  const done = useFeedbackList({ scope: "board", status: "done", sort: SORT.done });
  const lists: Record<RoadmapStatus, ReturnType<typeof useFeedbackList>> = { approved, planned, done };
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.stats().then(
      (v) => alive && setStats(v),
      // The columns still show their own totals.
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const { replace: replaceApproved } = approved;
  const { replace: replacePlanned } = planned;
  const { replace: replaceDone } = done;
  // A vote in the dialog updates the card in whichever column holds it.
  const replaceEverywhere = useCallback(
    (item: FeedbackItem) => {
      replaceApproved(item);
      replacePlanned(item);
      replaceDone(item);
    },
    [replaceApproved, replacePlanned, replaceDone],
  );
  const close = useCallback(() => {
    setOpenId(null);
    triggerRef.current?.focus();
  }, []);

  const suggest = onSuggest === false ? null : (onSuggest ?? (() => openFeedbackWidget({ kind: "idea" })));
  const total = stats?.total ?? ROADMAP_STATUSES.reduce((n, st) => n + lists[st].total, 0);
  const loadingAny = ROADMAP_STATUSES.some((st) => lists[st].loading);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-subheadline text-label-secondary" aria-live="polite">
          {stats || !loadingAny ? s.roadmapTotal(total) : s.loading}
        </p>
        {suggest ? (
          <Button variant="filled" size="sm" onClick={suggest}>
            {s.newIdea}
          </Button>
        ) : null}
      </div>
      {/* `contain-paint`: without it mobile browsers widen the layout viewport to the columns'
          full width (page-level horizontal scroll) despite the row's own overflow scrolling. */}
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 contain-paint md:grid md:snap-none md:grid-cols-3 md:items-start md:overflow-visible md:pb-0 md:contain-none">
        {ROADMAP_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            list={lists[status]}
            onOpen={(id, trigger) => {
              triggerRef.current = trigger;
              setOpenId(id);
            }}
          />
        ))}
      </div>
      {openId ? <DetailDialog id={openId} onClose={close} onChange={replaceEverywhere} /> : null}
    </section>
  );
}
