"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Cv } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  cx,
  DocumentIcon,
  Skeleton,
  Spinner,
  SpotIllustration,
  UploadIcon,
} from "@ujc/ui";
import { ApiError, getCv, giveAiConsent, uploadCv } from "@/lib/api";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md"];
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
]);
// Exported so `/cv`'s "Upload another" affordance (M4-04) can validate a file the same way
// without re-rendering this whole card.
export const ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME].join(",");
const WAITING_NOTE_MS = 20_000;
const POLL_MS = 2_000;

export function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is over 5 MB.";
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  const mimeOk = file.type ? ACCEPTED_MIME.has(file.type) : false;
  const extOk = ACCEPTED_EXTENSIONS.includes(ext);
  if (!mimeOk && !extOk) {
    return "We can read PDF, images, TXT or MD.";
  }
  return null;
}

export interface CvUploadCardProps {
  cv: Cv | null;
  /** Fires with the newly-created CV (on upload) and every poll tick while it scans. */
  onCvChange: (cv: Cv) => void;
  aiConsentAt: string | null;
  onConsentGranted: (grantedAt: string) => void;
}

/**
 * AI-processing consent gate + CV dropzone + scan-status polling (`GET /api/cvs/{id}` every
 * 2s) + the "done" result summary (headline/seniority/summary). Shared by `/cv` and the
 * onboarding wizard's CV step (docs/product/FLOW_V2.md) so both stay in sync.
 */
export function CvUploadCard({ cv, onCvChange, aiConsentAt, onConsentGranted }: CvUploadCardProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showWaitingNote, setShowWaitingNote] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const trackedCvIdRef = useRef<string | null>(null);
  const scanStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Poll a queued/processing CV every 2s until it's done or errors; stop on unmount.
  useEffect(() => {
    if (!cv || (cv.status !== "queued" && cv.status !== "processing")) {
      // Synchronously clears the note when a CV leaves the scanning state (e.g. flips to
      // `done`), rather than leaving it stale until some unrelated re-render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowWaitingNote(false);
      trackedCvIdRef.current = null;
      scanStartRef.current = null;
      return;
    }
    if (trackedCvIdRef.current !== cv.id) {
      trackedCvIdRef.current = cv.id;
      scanStartRef.current = Date.now();
      setShowWaitingNote(false);
    }
    let cancelled = false;
    const cvId = cv.id;
    const interval = setInterval(() => {
      if (scanStartRef.current != null && Date.now() - scanStartRef.current >= WAITING_NOTE_MS) {
        setShowWaitingNote(true);
      }
      getCv(cvId)
        .then((updated) => {
          if (!cancelled) onCvChange(updated);
        })
        .catch(() => {
          // Transient poll failure (e.g. a dropped request) — the next tick retries.
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Depends on the primitives that actually drive polling, not the whole `cv` object, so a
    // fresh object reference from the same poll doesn't tear down and restart the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv?.id, cv?.status]);

  async function handleConsent() {
    setConsenting(true);
    setConsentError(null);
    try {
      const { aiConsentAt: granted } = await giveAiConsent();
      onConsentGranted(granted);
    } catch (err) {
      setConsentError(
        err instanceof ApiError ? err.message : "Could not save your consent. Please try again.",
      );
    } finally {
      setConsenting(false);
    }
  }

  async function handleFile(file: File) {
    setUploadError(null);
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploading(true);
    try {
      const created = await uploadCv(file);
      onCvChange(created);
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Could not upload your CV. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  const scanning = cv != null && (cv.status === "queued" || cv.status === "processing");
  const showDropzone = !cv || cv.status === "error";
  // Before the very first upload, gate the dropzone behind AI-processing consent (M5-04): the
  // CV is sent to Claude (on the host machine) to extract skills, so we ask first.
  const needsConsent = showDropzone && !aiConsentAt;

  if (needsConsent) {
    return (
      <div
        role="region"
        aria-label="AI processing consent"
        className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card"
      >
        <p className="text-subheadline font-semibold text-label">Before you upload</p>
        <p className="text-body text-label-secondary">
          Your CV is sent to Claude, an AI model running on our host machine, to pull out your
          skills and keywords. It&apos;s stored until you delete it, or automatically after 180
          days.
        </p>
        {consentError ? (
          <p role="alert" className="text-footnote text-danger-ink">
            {consentError}
          </p>
        ) : null}
        <Button onClick={() => void handleConsent()} loading={consenting} className="self-start">
          I agree
        </Button>
      </div>
    );
  }

  if (showDropzone) {
    return (
      <div className="flex flex-col gap-3">
        {cv?.status === "error" ? (
          <div role="alert" className="flex flex-col gap-1 rounded-card bg-danger-soft px-4 py-3">
            <p className="text-subheadline font-semibold text-danger-ink">We couldn&apos;t read this file</p>
            <p className="text-footnote text-danger-ink">
              {cv.error ? cv.error : "If it's a photo or scan, try a clearer PDF."}
            </p>
          </div>
        ) : null}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={cx(
            "flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed p-10 text-center shadow-card transition-colors duration-200 focus-within:ring-4 focus-within:ring-tint/20",
            dragActive ? "border-tint bg-tint-soft" : "border-separator-opaque bg-grouped-secondary",
          )}
        >
          <SpotIllustration name="cv" />
          <div className="flex flex-col gap-1">
            <p className="text-title3 text-label">Start with your CV</p>
            <p className="max-w-xs text-body text-label-secondary">
              We&apos;ll pull out your skills and find jobs that fit.
            </p>
          </div>
          <span className={buttonClasses({ variant: "tinted" })}>
            <UploadIcon size={18} />
            Upload CV
          </span>
          <p className="text-footnote text-label-secondary">PDF, image, TXT or MD · up to 5 MB</p>
          {uploading ? (
            <p className="flex items-center gap-2 text-footnote text-label-secondary">
              <Spinner size={14} /> Uploading…
            </p>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {uploadError ? (
          <p role="alert" className="text-footnote text-danger-ink">
            {uploadError}
          </p>
        ) : null}
      </div>
    );
  }

  if (scanning && cv) {
    return (
      <div className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="flex size-[29px] shrink-0 items-center justify-center rounded-icon bg-tint text-on-tint">
            <DocumentIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-label">{cv.filename}</p>
            <p className="text-footnote text-label-secondary">Scanning your CV…</p>
          </div>
          {showWaitingNote ? (
            <Badge tone="warning">Waiting for the scanner</Badge>
          ) : cv.status === "processing" ? (
            <Badge tone="tint" icon={<Spinner size={12} />}>
              Scanning
            </Badge>
          ) : (
            <Badge>In queue</Badge>
          )}
        </div>
        <Skeleton className="h-2 w-full animate-shimmer" />
        <p className="text-footnote text-label-secondary">
          {showWaitingNote
            ? "Your CV is safe in the queue and will be read as soon as it's back."
            : "Usually under a minute. You can leave this page."}
        </p>
      </div>
    );
  }

  if (cv) {
    return (
      <div className="rounded-card bg-grouped-secondary p-4 shadow-card animate-pop-in">
        <div className="flex items-center gap-2">
          <h2 className="text-headline text-label">{cv.profile?.headline ?? "Your profile"}</h2>
          <Badge tone="success">Ready</Badge>
        </div>
        {cv.profile?.seniority ? (
          <p className="mt-0.5 text-footnote text-label-secondary">{cv.profile.seniority}</p>
        ) : null}
        {cv.profile?.summary ? (
          <p className="mt-2 text-body text-label">{cv.profile.summary}</p>
        ) : null}
      </div>
    );
  }

  return null;
}
