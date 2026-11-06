"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Application, ApplicationStatus } from "@ujc/core";
import {
  Badge,
  buttonClasses,
  Card,
  EmptyState,
  IconButton,
  JobCardSkeleton,
  NavBar,
  RefreshIcon,
  SegmentedControl,
  SourceBadge,
  TrashIcon,
} from "@ujc/ui";
import {
  ApiError,
  deleteApplication,
  listApplications,
  updateApplication,
  type ApplicationPatch,
} from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useApi } from "@/lib/use-api";
import { AccountMenu } from "@/app/nav";

type ColumnKey = "saved" | "applied" | "interviewing" | "offer" | "closed";
type ViewMode = "board" | "list";

const COLUMNS: ReadonlyArray<{ key: ColumnKey; statuses: ApplicationStatus[] }> = [
  { key: "saved", statuses: ["saved"] },
  { key: "applied", statuses: ["applied"] },
  { key: "interviewing", statuses: ["interviewing"] },
  { key: "offer", statuses: ["offer"] },
  { key: "closed", statuses: ["rejected", "withdrawn"] },
];

const STATUS_VALUES: ReadonlyArray<ApplicationStatus> = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

function columnFor(status: ApplicationStatus): ColumnKey {
  return COLUMNS.find((c) => (c.statuses as ApplicationStatus[]).includes(status))?.key ?? "saved";
}

interface ApplicationCardProps {
  application: Application;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onNoteBlur: (id: string, note: string) => void;
  onNextActionChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
}

function ApplicationCard({
  application,
  onStatusChange,
  onNoteBlur,
  onNextActionChange,
  onDelete,
}: ApplicationCardProps) {
  const { t } = useTranslation("tracker");
  const [note, setNote] = useState(application.note ?? "");
  const job = application.job;
  const name = job?.title ?? t("untitledApplication");
  const statusLabel: Record<ApplicationStatus, string> = {
    saved: t("status.saved"),
    applied: t("status.applied"),
    interviewing: t("status.interviewing"),
    offer: t("status.offer"),
    rejected: t("status.rejected"),
    withdrawn: t("status.withdrawn"),
  };

  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-subheadline font-semibold text-label">{job?.title ?? t("untitledJob")}</p>
          <p className="truncate text-footnote text-label-secondary">{job?.company ?? t("unknownCompany")}</p>
        </div>
        <IconButton
          label={t("deleteAria", { name })}
          icon={<TrashIcon size={16} />}
          variant="plain"
          size="sm"
          onClick={() => onDelete(application.id)}
        />
      </div>

      {job?.source ? <SourceBadge source={job.source} /> : null}

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        {t("fields.status")}
        <select
          aria-label={t("statusForAria", { name })}
          value={application.status}
          onChange={(e) => onStatusChange(application.id, e.target.value as ApplicationStatus)}
          className="h-9 rounded-control border border-control-border bg-background px-2 text-subheadline text-label focus-ring"
        >
          {STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {statusLabel[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        {t("fields.note")}
        <textarea
          aria-label={t("noteForAria", { name })}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onNoteBlur(application.id, note)}
          rows={2}
          className="rounded-control border border-control-border bg-background px-2 py-1 text-subheadline text-label focus-ring"
        />
      </label>

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        {t("fields.nextAction")}
        <input
          aria-label={t("nextActionForAria", { name })}
          type="date"
          value={application.nextActionAt ? application.nextActionAt.slice(0, 10) : ""}
          onChange={(e) => onNextActionChange(application.id, e.target.value)}
          className="h-9 rounded-control border border-control-border bg-background px-2 text-subheadline text-label focus-ring"
        />
      </label>
    </Card>
  );
}

function TrackerInner() {
  const { t } = useTranslation("tracker");
  const { data, loading, error, reload } = useApi(() => listApplications(), []);
  const [items, setItems] = useState<Application[]>([]);
  const [view, setView] = useState<ViewMode>("board");
  const [actionError, setActionError] = useState<string | null>(null);
  const columnLabel: Record<ColumnKey, string> = {
    saved: t("columns.saved"),
    applied: t("columns.applied"),
    interviewing: t("columns.interviewing"),
    offer: t("columns.offer"),
    closed: t("columns.closed"),
  };

  useEffect(() => {
    // Seeds local, editable state from the one-shot GET; subsequent mutations (status/note/
    // next-action/delete) update `items` directly rather than refetching.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setItems(data.items);
  }, [data]);

  const patch = useCallback(async (id: string, body: ApplicationPatch) => {
    setActionError(null);
    try {
      const updated = await updateApplication(id, body);
      setItems((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("errors.updateFailed"));
    }
  }, [t]);

  function onStatusChange(id: string, status: ApplicationStatus) {
    void patch(id, { status });
  }

  function onNoteBlur(id: string, note: string) {
    const current = items.find((a) => a.id === id);
    if (current && (current.note ?? "") === note) return;
    void patch(id, { note: note || null });
  }

  function onNextActionChange(id: string, value: string) {
    void patch(id, { nextActionAt: value ? new Date(value).toISOString() : null });
  }

  async function onDelete(id: string) {
    setActionError(null);
    try {
      await deleteApplication(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("errors.deleteFailed"));
    }
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [items],
  );

  return (
    <>
      <NavBar title={t("nav.title")} trailing={<div className="md:hidden"><AccountMenu /></div>}>
        <SegmentedControl
          label={t("view.label")}
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "board" as const, label: t("view.board") },
            { value: "list" as const, label: t("view.list") },
          ]}
        />
      </NavBar>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 sm:px-6">
        {actionError ? (
          <p role="alert" className="text-footnote text-danger-ink">
            {actionError}
          </p>
        ) : null}

        {loading ? (
          <div aria-busy="true" aria-label={t("loadingAria")} className="flex flex-col gap-3">
            <JobCardSkeleton />
            <JobCardSkeleton />
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title={t("loadError.title")}
            message={t("loadError.message")}
            action={
              <button type="button" onClick={reload} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                {t("common:tryAgain")}
              </button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            illustration="tracker"
            title={t("empty.title")}
            message={t("empty.message")}
          />
        ) : view === "board" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {COLUMNS.map((col) => {
              const colItems = sorted.filter((a) => columnFor(a.status) === col.key);
              return (
                <div key={col.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-subheadline font-semibold text-label">{columnLabel[col.key]}</h2>
                    <Badge>{colItems.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {colItems.map((a) => (
                      <ApplicationCard
                        key={a.id}
                        application={a}
                        onStatusChange={onStatusChange}
                        onNoteBlur={onNoteBlur}
                        onNextActionChange={onNextActionChange}
                        onDelete={(id) => void onDelete(id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((a) => (
              <ApplicationCard
                key={a.id}
                application={a}
                onStatusChange={onStatusChange}
                onNoteBlur={onNoteBlur}
                onNextActionChange={onNextActionChange}
                onDelete={(id) => void onDelete(id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function Tracker() {
  return (
    <RequireAuth>
      <TrackerInner />
    </RequireAuth>
  );
}
