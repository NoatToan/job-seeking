"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const COLUMNS: ReadonlyArray<{ key: ColumnKey; label: string; statuses: ApplicationStatus[] }> = [
  { key: "saved", label: "Saved", statuses: ["saved"] },
  { key: "applied", label: "Applied", statuses: ["applied"] },
  { key: "interviewing", label: "Interviewing", statuses: ["interviewing"] },
  { key: "offer", label: "Offer", statuses: ["offer"] },
  { key: "closed", label: "Closed", statuses: ["rejected", "withdrawn"] },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: ApplicationStatus; label: string }> = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
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
  const [note, setNote] = useState(application.note ?? "");
  const job = application.job;
  const name = job?.title ?? "this application";

  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-subheadline font-semibold text-label">{job?.title ?? "Untitled job"}</p>
          <p className="truncate text-footnote text-label-secondary">{job?.company ?? "Unknown company"}</p>
        </div>
        <IconButton
          label={`Delete ${name}`}
          icon={<TrashIcon size={16} />}
          variant="plain"
          size="sm"
          onClick={() => onDelete(application.id)}
        />
      </div>

      {job?.source ? <SourceBadge source={job.source} /> : null}

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        Status
        <select
          aria-label={`Status for ${name}`}
          value={application.status}
          onChange={(e) => onStatusChange(application.id, e.target.value as ApplicationStatus)}
          className="h-9 rounded-control border border-control-border bg-background px-2 text-subheadline text-label focus-ring"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        Note
        <textarea
          aria-label={`Note for ${name}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onNoteBlur(application.id, note)}
          rows={2}
          className="rounded-control border border-control-border bg-background px-2 py-1 text-subheadline text-label focus-ring"
        />
      </label>

      <label className="flex flex-col gap-1 text-footnote text-label-secondary">
        Next action
        <input
          aria-label={`Next action date for ${name}`}
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
  const { data, loading, error, reload } = useApi(() => listApplications(), []);
  const [items, setItems] = useState<Application[]>([]);
  const [view, setView] = useState<ViewMode>("board");
  const [actionError, setActionError] = useState<string | null>(null);

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
      setActionError(err instanceof ApiError ? err.message : "Could not update this application.");
    }
  }, []);

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
      setActionError(err instanceof ApiError ? err.message : "Could not delete this application.");
    }
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [items],
  );

  return (
    <>
      <NavBar title="Tracker" trailing={<div className="md:hidden"><AccountMenu /></div>}>
        <SegmentedControl
          label="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "board" as const, label: "Board" },
            { value: "list" as const, label: "List" },
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
          <div aria-busy="true" aria-label="Loading your tracker" className="flex flex-col gap-3">
            <JobCardSkeleton />
            <JobCardSkeleton />
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title="We couldn't load your tracker"
            message="It's on our side, not yours. Check your connection and try again."
            action={
              <button type="button" onClick={reload} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                Try again
              </button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            illustration="tracker"
            title="Nothing tracked yet"
            message="Save a job from your feed or search to start building your pipeline."
          />
        ) : view === "board" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {COLUMNS.map((col) => {
              const colItems = sorted.filter((a) => columnFor(a.status) === col.key);
              return (
                <div key={col.key} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-subheadline font-semibold text-label">{col.label}</h2>
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
