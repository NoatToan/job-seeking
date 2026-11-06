"use client";

import { useEffect, useId, useState } from "react";
import type { Job, JobCommunity, JobVoteReason, MyJobVote } from "@ujc/core";
import { JOB_VOTE_NOTE_MAX, JOB_VOTE_REASONS } from "@ujc/core";
import { AlertTriangleIcon, Button, cx, ThumbsDownIcon, ThumbsUpIcon, timeAgo, useOptionalToast, useUiStrings } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { ApiError, clearJobVotes, deleteJobVote, getMyJobVotes, putJobVote } from "@/lib/api";
import type { JobVoteInput } from "@/lib/api";
import { useRequireLogin } from "@/lib/login-modal";
import { useSession } from "@/lib/session";

/**
 * Community signal on a job (docs/DECISIONS.md "Job downvotes"): "Not worth applying?" reports
 * with a required reason, and "Still good" confirmations, so others don't waste an application.
 *
 * The public job payloads carry the aggregate (`job.community`, CDN-cacheable, the same for
 * everyone); the viewer's own vote comes from `GET /api/me/job-votes`, which also returns fresh
 * counts. Votes are optimistic: the buttons and counts move at once and roll back with a toast if
 * the request fails.
 */

/** "Not worth applying" pressed while signed out: signing in re-renders the home page as the
 * signed-in view, which mounts a new panel, so the picker opens from here once that panel mounts. */
let pickerAfterSignIn: { id: string; at: number } | null = null;
const PICKER_AFTER_SIGN_IN_MS = 15_000;

/** Reasons sorted for the picker; "other" last (it asks for a note). */
const REASONS: readonly JobVoteReason[] = JOB_VOTE_REASONS;

/** The aggregate after replacing `before` with `after` (both the viewer's own vote), for the
 * optimistic update. Only a vote that counts moves the numbers. */
export function applyVoteDelta(
  community: JobCommunity | null,
  before: MyJobVote | null,
  after: MyJobVote | null,
): JobCommunity | null {
  const next: JobCommunity = community
    ? { ...community, reasons: { ...community.reasons } }
    : { reports: 0, confirms: 0, flagged: false, topReason: null, reasons: {}, lastReportedAt: null };
  const move = (vote: MyJobVote | null, sign: 1 | -1) => {
    if (!vote || !vote.counted) return;
    if (vote.vote === "up") next.confirms = Math.max(0, next.confirms + sign);
    else {
      next.reports = Math.max(0, next.reports + sign);
      if (vote.reason) {
        const n = (next.reasons[vote.reason] ?? 0) + sign;
        if (n > 0) next.reasons[vote.reason] = n;
        else delete next.reasons[vote.reason];
      }
    }
  };
  move(before, -1);
  move(after, 1);
  if (after?.vote === "down" && after.counted) next.lastReportedAt = after.updatedAt;
  // The server recomputes `flagged` / `topReason`; until it answers keep a plain best guess.
  const top = Object.entries(next.reasons).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  next.topReason = (top?.[0] as JobVoteReason | undefined) ?? null;
  return next.reports || next.confirms ? next : null;
}

/** Compact row warning, shown only once the community flagged the job: "3 reports · Expired". */
export function CommunityFlagChip({ community }: { community?: JobCommunity | null }) {
  const { t } = useTranslation("job");
  if (!community?.flagged) return null;
  const reason = community.topReason ? t(`vote.short.${community.topReason}`) : null;
  const label = t("vote.chip", { count: community.reports });
  const title = t("vote.chipTitle", {
    count: community.reports,
    reason: community.topReason ? t(`vote.reasons.${community.topReason}`) : "",
  });
  return (
    <span
      title={title}
      className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-warning-soft px-2 text-caption font-semibold text-warning-ink"
    >
      <AlertTriangleIcon size={12} strokeWidth={2.25} aria-hidden className="shrink-0" />
      <span aria-hidden className="truncate">
        {label}
        {reason ? ` · ${reason}` : ""}
      </span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

function CommunitySummary({ community, id }: { community: JobCommunity | null; id: string }) {
  const { t } = useTranslation("job");
  const strings = useUiStrings();
  if (!community) {
    return (
      <p id={id} className="text-footnote text-label-secondary">
        {t("vote.none")}
      </p>
    );
  }
  const reasons = (Object.entries(community.reasons) as [JobVoteReason, number][]).sort((a, b) => b[1] - a[1]);
  const last = timeAgo(community.lastReportedAt, undefined, strings);
  return (
    <div id={id} className="flex flex-col gap-1.5">
      <p className={cx("text-subheadline font-semibold", community.flagged ? "text-warning-ink" : "text-label")}>
        {community.flagged ? <AlertTriangleIcon size={15} strokeWidth={2.25} aria-hidden className="mr-1 inline align-[-2px]" /> : null}
        {community.reports
          ? t("vote.summaryReports", { count: community.reports })
          : t("vote.summaryNoReports")}
        {community.confirms ? (
          <span className="font-normal text-label-secondary"> · {t("vote.summaryConfirms", { count: community.confirms })}</span>
        ) : null}
      </p>
      {reasons.length ? (
        <ul aria-label={t("vote.reasonsAria")} className="flex flex-wrap gap-1.5">
          {reasons.map(([reason, n]) => (
            <li
              key={reason}
              className="rounded-full border border-separator bg-background px-2 py-0.5 text-caption font-medium text-label"
            >
              {t(`vote.reasons.${reason}`)} <span className="text-label-secondary">×{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {last ? <p className="text-caption text-label-tertiary">{t("vote.lastReport", { when: last })}</p> : null}
    </div>
  );
}

export interface JobVotePanelProps {
  job: Job;
  signedIn: boolean;
}

/** "Worth applying?" box in the job detail: the community summary and the viewer's vote. */
export function JobVotePanel({ job, signedIn }: JobVotePanelProps) {
  const { t } = useTranslation("job");
  const toast = useOptionalToast();
  const requireLogin = useRequireLogin();
  const { me } = useSession();
  const isAdmin = me?.user.role === "admin";
  // What we learnt since this job was rendered (the viewer's vote, fresher counts), keyed by job
  // id so a different job never shows another job's state; otherwise the public payload.
  const [local, setLocal] = useState<{ id: string; mine: MyJobVote | null; community?: JobCommunity | null }>({
    id: job.id,
    mine: null,
  });
  const current = local.id === job.id ? local : { id: job.id, mine: null };
  const mine = current.mine;
  const community = current.community !== undefined ? current.community : (job.community ?? null);
  const setMine = (vote: MyJobVote | null) => setLocal((s) => ({ ...(s.id === job.id ? s : { id: job.id }), mine: vote }));
  const setCommunity = (c: JobCommunity | null) =>
    setLocal((s) => ({ ...(s.id === job.id ? s : { id: job.id, mine: null }), community: c }));
  const [picking, setPicking] = useState(() => {
    const pending = pickerAfterSignIn;
    if (!signedIn || pending?.id !== job.id) return false;
    pickerAfterSignIn = null;
    return Date.now() - pending.at < PICKER_AFTER_SIGN_IN_MS;
  });
  const [reason, setReason] = useState<JobVoteReason | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState("");
  const summaryId = useId();
  const pickerId = useId();
  const noteId = useId();

  // Signed in: the viewer's own vote and fresh counts (the public payload may lag the CDN).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const id = job.id;
    getMyJobVotes([id])
      .then((res) => {
        if (cancelled) return;
        setLocal({
          id,
          mine: res.votes[id] ?? null,
          ...(id in res.community ? { community: res.community[id] ?? null } : {}),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job.id, signedIn]);

  async function submit(input: JobVoteInput | null) {
    if (pending) return;
    const before = { mine, community };
    const optimistic: MyJobVote | null = input
      ? {
          vote: input.vote,
          reason: input.vote === "down" ? input.reason : null,
          note: input.vote === "down" ? (input.note ?? null) : null,
          updatedAt: new Date().toISOString(),
          // Unknown until the server answers; assume it counts (it does for most accounts).
          counted: mine?.counted ?? true,
        }
      : null;
    setMine(optimistic);
    setCommunity(applyVoteDelta(community, mine, optimistic));
    setPicking(false);
    setPending(true);
    try {
      const res = input ? await putJobVote(job.id, input) : await deleteJobVote(job.id);
      setMine(res.vote);
      setCommunity(res.community);
      const message = !input
        ? t("vote.removed")
        : input.vote === "up"
          ? t("vote.thanksUp")
          : t("vote.thanksDown", { reason: t(`vote.reasons.${input.reason}`) });
      setAnnounce(message);
      toast.show({
        tone: "success",
        title: message,
        message: res.vote && !res.vote.counted ? t("vote.notCountedYet") : undefined,
      });
      setReason(null);
      setNote("");
    } catch (err) {
      setMine(before.mine);
      setCommunity(before.community);
      const message =
        err instanceof ApiError && err.code === "rate_limited" ? t("vote.rateLimited") : t("vote.failed");
      setAnnounce(message);
      toast.show({ tone: "error", title: message, message: err instanceof ApiError ? undefined : String(err) });
    } finally {
      setPending(false);
    }
  }

  const onUp = () =>
    requireLogin(() => void submit(mine?.vote === "up" ? null : { vote: "up" }), { reason: t("vote.signInReason") });
  const onDown = () => {
    if (!signedIn) pickerAfterSignIn = { id: job.id, at: Date.now() };
    requireLogin(
      () => {
        if (mine?.vote === "down" && !picking) {
          // Pressed again: take the report back.
          void submit(null);
          return;
        }
        setReason(mine?.vote === "down" ? mine.reason : null);
        setNote(mine?.note ?? "");
        setPicking((open) => !open);
      },
      { reason: t("vote.signInReason") },
    );
  };

  const noteRequired = reason === "other";
  const canReport = reason !== null && (!noteRequired || note.trim().length > 0);

  async function onClear() {
    try {
      const res = await clearJobVotes(job.id);
      setCommunity(res.community);
      // Votes written before the clear (including the admin's own) stop counting.
      if (mine) setMine({ ...mine, counted: false });
      setAnnounce(t("vote.cleared"));
      toast.show({ tone: "success", title: t("vote.cleared") });
    } catch {
      toast.show({ tone: "error", title: t("vote.failed") });
    }
  }

  return (
    <section
      aria-labelledby={`${summaryId}-title`}
      className={cx(
        "flex flex-col gap-3 rounded-card border p-3.5",
        community?.flagged ? "border-warning/40 bg-warning-soft" : "border-separator bg-background",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`${summaryId}-title`} className="text-headline text-label">
            {t("vote.title")}
          </h2>
          <CommunitySummary community={community} id={summaryId} />
        </div>
        <div role="group" aria-label={t("vote.groupAria")} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant={mine?.vote === "up" ? "tinted" : "gray"}
            size="sm"
            aria-pressed={mine?.vote === "up"}
            aria-describedby={summaryId}
            icon={<ThumbsUpIcon size={15} strokeWidth={2} />}
            onClick={onUp}
            disabled={pending}
            className="flex-1 sm:flex-none"
          >
            {t("vote.up")}
          </Button>
          <Button
            variant={mine?.vote === "down" ? "destructive" : "gray"}
            size="sm"
            aria-pressed={mine?.vote === "down"}
            aria-expanded={picking}
            aria-controls={pickerId}
            aria-describedby={summaryId}
            icon={<ThumbsDownIcon size={15} strokeWidth={2} />}
            onClick={onDown}
            disabled={pending}
            className="flex-1 sm:flex-none"
          >
            {t("vote.down")}
          </Button>
        </div>
      </div>

      {mine && !picking ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-label-secondary">
          <span>
            {mine.vote === "up"
              ? t("vote.mineUp")
              : t("vote.mineDown", { reason: mine.reason ? t(`vote.reasons.${mine.reason}`) : "" })}
            {!mine.counted ? ` ${t("vote.notCountedYet")}` : ""}
          </span>
          {mine.vote === "down" ? (
            <button
              type="button"
              onClick={() => {
                setReason(mine.reason);
                setNote(mine.note ?? "");
                setPicking(true);
              }}
              className="rounded-control-sm font-medium text-tint hover:underline focus-ring"
            >
              {t("vote.change")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit(null)}
            className="rounded-control-sm font-medium text-tint hover:underline focus-ring disabled:opacity-50"
          >
            {t("vote.remove")}
          </button>
        </p>
      ) : null}

      <div id={pickerId} hidden={!picking}>
        {picking ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason || !canReport) return;
              void submit({ vote: "down", reason, ...(note.trim() ? { note: note.trim() } : {}) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setPicking(false);
              }
            }}
            className="flex flex-col gap-3 hairline-t pt-3"
          >
            <fieldset>
              <legend className="text-subheadline font-semibold text-label">{t("vote.pickerTitle")}</legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <label
                    key={r}
                    className={cx(
                      "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3 text-footnote font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tint pointer-coarse:min-h-11",
                      reason === r
                        ? "border-danger/50 bg-danger-soft text-danger-ink"
                        : "border-separator bg-background text-label hover:bg-fill-tertiary",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${pickerId}-reason`}
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="sr-only"
                    />
                    {t(`vote.reasons.${r}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            {reason === "other" || note ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={noteId} className="text-footnote font-medium text-label">
                  {noteRequired ? t("vote.noteLabelRequired") : t("vote.noteLabel")}
                </label>
                <textarea
                  id={noteId}
                  value={note}
                  maxLength={JOB_VOTE_NOTE_MAX}
                  rows={2}
                  required={noteRequired}
                  aria-describedby={`${noteId}-count`}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("vote.notePlaceholder")}
                  className="w-full resize-none rounded-control border border-separator bg-background px-3 py-2 text-body text-label placeholder:text-label-tertiary focus-ring"
                />
                <p id={`${noteId}-count`} className="text-right text-caption text-label-tertiary tabular-nums">
                  {note.length}/{JOB_VOTE_NOTE_MAX} · {t("vote.notePrivate")}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={!canReport || pending}>
                {mine?.vote === "down" ? t("vote.update") : t("vote.submit")}
              </Button>
              <Button type="button" variant="plain" size="sm" onClick={() => setPicking(false)}>
                {t("vote.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {isAdmin && community ? (
        <p className="hairline-t pt-2 text-footnote">
          <button type="button" onClick={() => void onClear()} className="rounded-control-sm font-medium text-tint hover:underline focus-ring">
            {t("vote.adminClear")}
          </button>
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
