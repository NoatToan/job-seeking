"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BookmarkIcon, Button, buttonClasses, CheckIcon } from "@ujc/ui";
import { ApiError, saveApplication } from "@/lib/api";

export interface SaveJobButtonProps {
  jobId: string;
  /** Idle label. Default "Save" (job cards). Pass "Track" on the job detail page. */
  label?: string;
  /** Label once tracked. Default "Saved ✓". */
  savedLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Pass `false` when the viewer isn't signed in (e.g. the public home page, or the job detail
   * page viewed signed out): renders a "Sign in to {label}" link to `/login/` instead of calling
   * the session-only save endpoint. Default `true` (every existing caller is already behind a
   * signed-in gate). */
  signedIn?: boolean;
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
  signedIn = true,
}: SaveJobButtonProps) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a second click firing before the `loading` state re-render commits (state
  // updates are not synchronous), so `saveApplication` is only ever called once per mount.
  const inFlightRef = useRef(false);

  if (!signedIn) {
    return (
      <Link
        href="/login/"
        className={buttonClasses({ variant: "gray", size, className })}
      >
        <BookmarkIcon size={14} />
        Sign in to {label.toLowerCase()}
      </Link>
    );
  }

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
