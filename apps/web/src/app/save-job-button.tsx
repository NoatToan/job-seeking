"use client";

import { useRef, useState } from "react";
import { BookmarkIcon, Button, CheckIcon } from "@ujc/ui";
import { ApiError, saveApplication } from "@/lib/api";

export interface SaveJobButtonProps {
  jobId: string;
  /** Idle label. Default "Save" (job cards). Pass "Track" on the job detail page. */
  label?: string;
  /** Label once tracked. Default "Saved ✓". */
  savedLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * "Save" / "Saved ✓" action for a job card or the job detail page. `POST /api/applications`
 * is idempotent (tracking an already-tracked job just returns it), so a second click never
 * creates a duplicate — this only ever fires one request per mount.
 */
export function SaveJobButton({
  jobId,
  label = "Save",
  savedLabel = "Saved ✓",
  size = "sm",
  className,
}: SaveJobButtonProps) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a second click firing before the `loading` state re-render commits (state
  // updates are not synchronous), so `saveApplication` is only ever called once per mount.
  const inFlightRef = useRef(false);

  async function onSave() {
    if (saved || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      await saveApplication(jobId);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this job.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <span className={className}>
      <Button
        variant={saved ? "tinted" : "gray"}
        size={size}
        icon={saved ? <CheckIcon size={14} /> : <BookmarkIcon size={14} />}
        loading={loading}
        disabled={saved}
        onClick={() => void onSave()}
      >
        {saved ? savedLabel : label}
      </Button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </span>
  );
}
