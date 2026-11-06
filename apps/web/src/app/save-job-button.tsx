"use client";

import { useRef, useState } from "react";
import { BookmarkIcon, Button, CheckIcon, cx } from "@ujc/ui";
import { useRequireLogin } from "@/lib/login-modal";

const ICON_BUTTON =
  "inline-flex size-9 items-center justify-center rounded-full transition-colors duration-150 hover:bg-fill-tertiary focus-ring disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:size-11";
import { useTranslation } from "react-i18next";
import { ApiError, saveApplication } from "@/lib/api";

export interface SaveJobButtonProps {
  jobId: string;
  /** Idle label. Default "Save" (job cards). Pass "Track" on the job detail page. */
  label?: string;
  /** Label once tracked. Default "Saved ✓". */
  savedLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Job rows: just the bookmark (outline = save, filled = saved), the words live in the label
   * and tooltip. The detail page keeps the labelled button. */
  compact?: boolean;
  /** Pass `false` when the viewer isn't signed in (e.g. the public home page, or the job detail
   * page viewed signed out): pressing the button opens the login modal and saves after sign-in,
   * instead of calling
   * the session-only save endpoint. Default `true` (every existing caller is already behind a
   * signed-in gate). */
  signedIn?: boolean;
}

/**
 * "Save" / "Saved ✓" action (optimistic: flips to "Saved" on click, reverts with a message if the
 * request fails) for a job card or the job detail page. `POST /api/applications`
 * is idempotent (tracking an already-tracked job just returns it), so a second click never
 * creates a duplicate — this only ever fires one request per mount.
 */
export function SaveJobButton({
  jobId,
  label,
  savedLabel,
  size = "sm",
  className,
  signedIn = true,
  compact = false,
}: SaveJobButtonProps) {
  const { t } = useTranslation("home");
  const requireLogin = useRequireLogin();
  const idleLabel = label ?? t("save.save");
  const doneLabel = savedLabel ?? t("save.saved");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a second click firing before the `saved` state re-render commits (state
  // updates are not synchronous), so `saveApplication` is only ever called once per mount.
  const inFlightRef = useRef(false);

  async function onSave() {
    if (saved || inFlightRef.current) return;
    inFlightRef.current = true;
    // UI first: show "Saved" now, the request runs behind it; roll back only if it fails.
    setSaved(true);
    setError(null);
    try {
      await saveApplication(jobId);
    } catch (err) {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : t("save.errorMessage"));
    } finally {
      inFlightRef.current = false;
    }
  }

  // Signed out: the same button; pressing it opens the login modal in place and the save runs as
  // soon as the visitor has signed in (no trip to /login, the list and selection stay put).
  const act = () =>
    signedIn ? void onSave() : requireLogin(() => void onSave(), { reason: t("save.signInReason") });

  if (compact) {
    const label = saved ? doneLabel : idleLabel;
    return (
      <span className={cx("inline-flex items-center", className)}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={saved}
          title={error ?? label}
          disabled={saved}
          onClick={act}
          className={cx(ICON_BUTTON, saved ? "text-tint" : "text-label-secondary hover:text-label")}
        >
          <BookmarkIcon size={17} strokeWidth={2} className={cx(saved && "fill-current")} />
        </button>
        {error ? <span role="alert" className="sr-only">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className={className}>
      <Button
        variant={saved ? "tinted" : "gray"}
        size={size}
        icon={saved ? <CheckIcon size={14} /> : <BookmarkIcon size={14} />}
        disabled={saved}
        onClick={act}
      >
        {saved ? doneLabel : idleLabel}
      </Button>
      {error ? (
        <span role="alert" className="ml-2 text-footnote text-danger-ink">
          {error}
        </span>
      ) : null}
    </span>
  );
}
