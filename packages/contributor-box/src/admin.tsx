"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { NoteList, useFeedbackList } from "./board";
import { useContributor } from "./context";
import { safeHref } from "./safe-url";
import type {
  FeedbackItem,
  FeedbackKind,
  FeedbackMeta,
  FeedbackStatus,
  NoteVisibility,
} from "./types";
import { KINDS, STATUSES } from "./types";
import { Button, cx, formatDate, inputClasses, KindBadge, Label, StatusBadge } from "./ui";

/** "email", "Name (Anonymous)" or "Anonymous". */
export function authorLabel(item: FeedbackItem, anonymous: string): string {
  const author = item.author;
  if (!author) return "—";
  if (author.anonymous) return author.name ? `${author.name} (${anonymous})` : anonymous;
  return author.email ?? "—";
}

function ContextBlock({ item }: { item: FeedbackItem }) {
  const { api, strings: s } = useContributor();
  const c = item.context;
  if (!c) return null;
  const href = safeHref(c.pageUrl);
  const rows: Array<[string, string | null]> = [
    [s.selector, c.elementSelector],
    [s.elementText, c.elementText],
    [s.region, c.region ? `${c.region.width} × ${c.region.height} @ ${c.region.x},${c.region.y}` : null],
    [s.viewport, c.viewportWidth && c.viewportHeight ? `${c.viewportWidth} × ${c.viewportHeight}` : null],
    [s.userAgent, c.userAgent],
  ];
  const empty = !c.pageUrl && rows.every(([, v]) => !v) && !c.hasScreenshot;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-footnote font-semibold text-label-secondary">{s.context}</h3>
      {empty ? <p className="text-footnote text-label-tertiary">{s.noContext}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-footnote">
        {c.pageUrl ? (
          <>
            <dt className="text-label-tertiary">{s.pageLabel}</dt>
            <dd className="min-w-0 break-all">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-tint underline">
                  {c.pageUrl}
                </a>
              ) : (
                c.pageUrl
              )}
              {c.pageTitle ? <span className="block text-label-secondary">{c.pageTitle}</span> : null}
            </dd>
          </>
        ) : null}
        {rows.map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <dt className="text-label-tertiary">{label}</dt>
              <dd className="min-w-0 break-all font-mono text-label">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {c.hasScreenshot ? (
        <a href={api.screenshotUrl(item.id)} target="_blank" rel="noopener noreferrer" className="block focus-ring rounded-control">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={api.screenshotUrl(item.id)}
            alt={s.screenshotAlt}
            loading="lazy"
            className="max-h-96 w-full rounded-control border border-separator object-contain object-top"
          />
        </a>
      ) : null}
    </section>
  );
}

function Editor({ item, onSaved, onDeleted }: { item: FeedbackItem; onSaved: (i: FeedbackItem) => void; onDeleted: (id: string) => void }) {
  const { api, strings: s } = useContributor();
  const uid = useId();
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [kind, setKind] = useState<FeedbackKind>(item.kind);
  const [status, setStatus] = useState<FeedbackStatus>(item.status);
  const [response, setResponse] = useState(item.adminResponse ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("internal");
  const [noteBusy, setNoteBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) return;
    setState("saving");
    try {
      const patch: Parameters<typeof api.update>[1] = {};
      if (title.trim() !== item.title) patch.title = title.trim();
      if (body.trim() !== item.body) patch.body = body.trim();
      if (kind !== item.kind) patch.kind = kind;
      if (status !== item.status) patch.status = status;
      if ((response.trim() || null) !== item.adminResponse) patch.adminResponse = response.trim() || null;
      const next = await api.update(item.id, patch);
      onSaved(next);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setNoteBusy(true);
    try {
      await api.addNote(item.id, note.trim(), visibility);
      setNote("");
      onSaved(await api.get(item.id));
    } catch {
      setState("error");
    } finally {
      setNoteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5 text-caption text-label-tertiary">
        <KindBadge kind={item.kind} label={s.kind[item.kind]} />
        <StatusBadge status={item.status} label={s.status[item.status]} />
        <span>
          {s.author}: {authorLabel(item, s.anonymous)} · {s.createdAt}: {formatDate(item.createdAt)} ·{" "}
          {s.votes(item.voteCount)}
        </span>
      </div>

      <form onSubmit={save} className="flex flex-col gap-3">
        <div>
          <Label htmlFor={`${uid}-title`}>{s.titleLabel}</Label>
          <input id={`${uid}-title`} className={inputClasses} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${uid}-body`}>{s.bodyLabel}</Label>
          <textarea id={`${uid}-body`} className={cx(inputClasses, "min-h-28 resize-y")} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${uid}-kind`}>{s.kindLabel}</Label>
            <select id={`${uid}-kind`} className={inputClasses} value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{s.kind[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`${uid}-status`}>{s.statusLabel}</Label>
            <select id={`${uid}-status`} className={inputClasses} value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
              {STATUSES.map((st) => (
                <option key={st} value={st}>{s.status[st]}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Label htmlFor={`${uid}-response`}>{s.responseLabel}</Label>
          <textarea id={`${uid}-response`} className={cx(inputClasses, "min-h-20 resize-y")} value={response} maxLength={5000} onChange={(e) => setResponse(e.target.value)} aria-describedby={`${uid}-response-hint`} />
          <p id={`${uid}-response-hint`} className="mt-1 text-footnote text-label-tertiary">{s.responseHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="filled" disabled={state === "saving"}>
            {state === "saving" ? s.saving : s.save}
          </Button>
          <span role="status" className="text-footnote text-label-secondary">
            {state === "saved" ? s.saved : state === "error" ? s.errorGeneric : ""}
          </span>
        </div>
      </form>

      <ContextBlock item={item} />

      <section className="flex flex-col gap-2">
        <h3 className="text-footnote font-semibold text-label-secondary">{s.notes}</h3>
        {item.notes && item.notes.length > 0 ? (
          <NoteList notes={item.notes} />
        ) : (
          <p className="text-footnote text-label-tertiary">{s.noNotes}</p>
        )}
        {item.notes?.some((n) => n.kind === "note") ? (
          <ul className="flex flex-wrap gap-2">
            {item.notes
              .filter((n) => n.kind === "note")
              .map((n) => (
                <li key={n.id}>
                  <Button
                    size="sm"
                    variant="plain"
                    aria-label={`${s.deleteNote}: ${n.body.slice(0, 40)}`}
                    onClick={async () => {
                      try {
                        await api.deleteNote(item.id, n.id);
                        onSaved(await api.get(item.id));
                      } catch {
                        setState("error");
                      }
                    }}
                  >
                    {s.deleteNote} #{n.id}
                  </Button>
                </li>
              ))}
          </ul>
        ) : null}
        <form onSubmit={addNote} className="flex flex-col gap-2">
          <Label htmlFor={`${uid}-note`}>{s.noteLabel}</Label>
          <textarea id={`${uid}-note`} className={cx(inputClasses, "min-h-16 resize-y")} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={s.visibilityLabel} className="min-h-8 rounded-control border border-control-border bg-background px-2 text-footnote text-label focus-ring" value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
              <option value="internal">{s.visibilityInternal}</option>
              <option value="public">{s.visibilityPublic}</option>
            </select>
            <Button type="submit" size="sm" variant="tinted" disabled={noteBusy || !note.trim()}>
              {s.addNote}
            </Button>
          </div>
        </form>
      </section>

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
              setState("error");
            }
          }}
        >
          {s.deleteItem}
        </Button>
      </div>
    </div>
  );
}

/**
 * Admin review queue: every item, filterable by status/type/text; select one to edit it, set its
 * status, write a public reply, add internal or public notes, or delete it. The server checks the
 * admin role on every call; `meta.isAdmin` only decides what to render.
 */
export function AdminReview() {
  const { api, strings: s } = useContributor();
  const [meta, setMeta] = useState<FeedbackMeta | null>(null);
  const [metaError, setMetaError] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus | "all">("new");
  const [kind, setKind] = useState<FeedbackKind | "all">("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  useEffect(() => {
    let alive = true;
    api.meta().then(
      (m) => alive && setMeta(m),
      () => alive && setMetaError(true),
    );
    return () => {
      alive = false;
    };
  }, [api]);

  if (metaError) return <p role="alert" className="text-subheadline text-danger">{s.errorGeneric}</p>;
  if (!meta) return <p className="text-subheadline text-label-secondary">{s.loading}</p>;
  if (!meta.isAdmin) return <p role="alert" className="text-subheadline text-label-secondary">{s.forbidden}</p>;
  return (
    <AdminQueue
      status={status}
      setStatus={setStatus}
      kind={kind}
      setKind={setKind}
      q={q}
      setQ={setQ}
      query={query}
      setQuery={setQuery}
      selected={selected}
      setSelected={setSelected}
    />
  );
}

function AdminQueue(props: {
  status: FeedbackStatus | "all";
  setStatus: (v: FeedbackStatus | "all") => void;
  kind: FeedbackKind | "all";
  setKind: (v: FeedbackKind | "all") => void;
  q: string;
  setQ: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  selected: FeedbackItem | null;
  setSelected: (v: FeedbackItem | null) => void;
}) {
  const { api, strings: s } = useContributor();
  const { status, kind, query, selected, setSelected } = props;
  const list = useFeedbackList({
    scope: "all",
    sort: "new",
    status: status === "all" ? undefined : status,
    kind: kind === "all" ? undefined : kind,
    q: query || undefined,
  });

  // Only the latest click wins: a slow response for an earlier item must not replace it.
  const openRequest = useRef(0);
  const open = async (id: string) => {
    const request = ++openRequest.current;
    try {
      const item = await api.get(id);
      if (request === openRequest.current) setSelected(item);
    } catch {
      if (request === openRequest.current) setSelected(null);
    }
  };

  const selectClasses =
    "min-h-8 rounded-control border border-control-border bg-background px-2 text-footnote text-label focus-ring";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className={cx("flex flex-col gap-3", selected && "hidden lg:flex")}>
        <form
          role="search"
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            props.setQuery(props.q.trim());
          }}
        >
          <select aria-label={s.statusLabel} className={selectClasses} value={status} onChange={(e) => props.setStatus(e.target.value as FeedbackStatus | "all")}>
            <option value="all">{s.allStatuses}</option>
            {STATUSES.map((st) => (
              <option key={st} value={st}>{s.status[st]}</option>
            ))}
          </select>
          <select aria-label={s.kindLabel} className={selectClasses} value={kind} onChange={(e) => props.setKind(e.target.value as FeedbackKind | "all")}>
            <option value="all">{s.allKinds}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{s.kind[k]}</option>
            ))}
          </select>
          <input
            type="search"
            aria-label={s.search}
            placeholder={s.search}
            maxLength={100}
            value={props.q}
            onChange={(e) => props.setQ(e.target.value)}
            className={cx(selectClasses, "min-w-0 flex-1")}
          />
        </form>
        <div aria-busy={list.loading}>
          {list.error ? <p role="alert" className="text-footnote text-danger">{s.errorGeneric}</p> : null}
          <ul className="flex flex-col gap-2">
            {list.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={selected?.id === item.id ? "true" : undefined}
                  onClick={() => void open(item.id)}
                  className={cx(
                    "w-full rounded-card border bg-grouped-secondary p-3 text-left shadow-card transition-colors duration-150 focus-ring",
                    selected?.id === item.id ? "border-tint bg-tint-soft" : "border-separator hover:bg-fill-tertiary",
                  )}
                >
                  <span className="block truncate text-headline text-label">{item.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={item.kind} label={s.kind[item.kind]} />
                    <StatusBadge status={item.status} label={s.status[item.status]} />
                    <span className="text-caption text-label-tertiary">{formatDate(item.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!list.loading && list.items.length === 0 && !list.error ? (
            <p className="p-4 text-center text-footnote text-label-tertiary">{s.emptyQueue}</p>
          ) : null}
          {list.loading ? <p className="py-3 text-center text-footnote text-label-tertiary">{s.loading}</p> : null}
          {!list.loading && list.items.length < list.total ? (
            <div className="pt-2 text-center">
              <Button size="sm" variant="gray" onClick={() => void list.loadMore()}>
                {s.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <div className={cx("min-w-0 rounded-card border border-separator bg-grouped-secondary p-4 shadow-card", !selected && "hidden lg:block")}>
        {selected ? (
          <>
            <div className="mb-3 lg:hidden">
              <Button size="sm" variant="plain" onClick={() => setSelected(null)}>
                ‹ {s.back}
              </Button>
            </div>
            <Editor
              // Reset the form only when another item is opened; saves and notes update in place.
              key={selected.id}
              item={selected}
              onSaved={(next) => {
                setSelected(next);
                list.replace(next);
              }}
              onDeleted={(id) => {
                list.removeItem(id);
                setSelected(null);
              }}
            />
          </>
        ) : (
          <p className="text-subheadline text-label-secondary">{s.selectItem}</p>
        )}
      </div>
    </div>
  );
}
