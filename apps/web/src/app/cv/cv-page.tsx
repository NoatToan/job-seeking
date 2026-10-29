"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import type { Cv } from "@ujc/core";
import { CANDIDATE_COUNTRIES } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  ChevronRightIcon,
  Chip,
  cx,
  DocumentIcon,
  NavBar,
  ProgressSteps,
  Skeleton,
  Spinner,
  SpotIllustration,
  TextField,
  Toggle,
  UploadIcon,
  useToast,
} from "@ujc/ui";
import { ApiError, getCv, updatePreferences, uploadCv } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { AccountMenu } from "@/app/nav";

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
const ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME].join(",");
const WAITING_NOTE_MS = 20_000;
const POLL_MS = 2_000;
const ONBOARDING_STEPS = ["Sign in", "Your CV", "Keywords"];

function validateFile(file: File): string | null {
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

function CvPageInner() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const [cv, setCv] = useState<Cv | null>(me?.latestCv ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showWaitingNote, setShowWaitingNote] = useState(false);

  const [keywords, setKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(me?.preferences.remoteOnly ?? false);
  const [candidateCountry, setCandidateCountry] = useState(me?.preferences.candidateCountry ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keywordsEverSaved, setKeywordsEverSaved] = useState((me?.preferences.keywords.length ?? 0) > 0);

  const seededCvIdRef = useRef<string | null>(null);
  const trackedCvIdRef = useRef<string | null>(null);
  const scanStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Captured once (not derived every render): whether this is the user's first time through
  // onboarding, so the ProgressSteps stays stable even as `keywords` is edited.
  const [isFirstRun] = useState((me?.preferences.keywords.length ?? 0) === 0);

  // Seed the keyword editor once per CV that finishes scanning (not on every poll tick).
  useEffect(() => {
    if (cv?.status === "done" && seededCvIdRef.current !== cv.id) {
      seededCvIdRef.current = cv.id;
      setKeywords(cv.keywords);
    }
  }, [cv]);

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
          if (!cancelled) setCv(updated);
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
      setCv(created);
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

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value) {
      setKeywordInput("");
      return;
    }
    if (value.length > 40) {
      setKeywordError("Keywords can be up to 40 characters.");
      return;
    }
    if (keywords.length >= 30) {
      setKeywordError("You can add up to 30 keywords.");
      return;
    }
    setKeywordError(null);
    if (keywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
      setKeywordInput("");
      return;
    }
    setKeywords((prev) => [...prev, value]);
    setKeywordInput("");
  }

  function removeKeyword(target: string) {
    setKeywords((prev) => prev.filter((k) => k !== target));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await updatePreferences({
        keywords,
        remoteOnly,
        candidateCountry: candidateCountry || null,
      });
      await refresh();
      setKeywordsEverSaved(true);
      toast.show({ tone: "success", title: "Saved", message: "Saved. Here are your jobs." });
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Could not save your preferences. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const scanning = cv != null && (cv.status === "queued" || cv.status === "processing");
  const showDropzone = !cv || cv.status === "error";
  const showProgressSteps = isFirstRun && !keywordsEverSaved;

  return (
    <>
      <NavBar title="My CV" trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
        {showProgressSteps ? (
          <ProgressSteps label="Setup progress" steps={ONBOARDING_STEPS} current={cv?.status === "done" ? 2 : 1} />
        ) : null}

        <p className="text-body text-label-secondary">
          Upload your CV once — we scan it for skills and keywords, and match you to jobs automatically.
        </p>

        {showDropzone ? (
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
        ) : scanning ? (
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
        ) : cv ? (
          <div className="flex flex-col gap-5 animate-pop-in">
            <div className="rounded-card bg-grouped-secondary p-4 shadow-card">
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

            <div className="flex flex-col gap-2">
              <h2 className="text-title2 text-label">Here&apos;s what we found</h2>
              <p className="text-body text-label-secondary">Remove anything that doesn&apos;t fit, or add your own.</p>
              {keywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((k) => (
                    <Chip key={k} onRemove={() => removeKeyword(k)}>
                      {k}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-subheadline text-label-secondary">Add at least one keyword below.</p>
              )}
              <TextField
                id="keyword-input"
                label="Keywords"
                value={keywordInput}
                onChange={(e) => {
                  setKeywordInput(e.target.value);
                  setKeywordError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Add a keyword and press Enter"
                error={keywordError ?? undefined}
              />
            </div>

            <section aria-label="Where you can work" className="flex flex-col gap-1.5">
              <h3 className="px-1 text-footnote font-normal uppercase tracking-wide text-label-secondary">
                Where you can work
              </h3>
              <div className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex-1 text-body text-label">Remote only</span>
                  <Toggle label="Remote only" checked={remoteOnly} onChange={setRemoteOnly} />
                </div>
                <label className="relative flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 hairline-t transition-colors duration-150 hover:bg-fill-tertiary focus-within:bg-fill-tertiary">
                  <span className="flex-1 text-body text-label">I&apos;m based in</span>
                  <select
                    id="candidate-country"
                    value={candidateCountry ?? ""}
                    onChange={(e) => setCandidateCountry(e.target.value)}
                    className="appearance-none rounded-control-sm bg-transparent text-right text-body text-label-secondary focus-ring"
                  >
                    <option value="">Select a country…</option>
                    {CANDIDATE_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <ChevronRightIcon size={16} strokeWidth={2.25} className="shrink-0 text-label-quaternary" />
                </label>
              </div>
              <p className="px-4 text-footnote text-label-secondary">
                We&apos;ll hide remote jobs that aren&apos;t open to where you are.
              </p>
            </section>

            {saveError ? (
              <p role="alert" className="text-footnote text-danger-ink">
                {saveError}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                disabled={keywords.length === 0}
              >
                Save
              </Button>
              <Link
                href="/"
                className="ml-auto inline-flex h-11 items-center gap-1 rounded-control px-1 text-body font-semibold text-tint hover:underline focus-ring"
              >
                See my jobs
                <ChevronRightIcon size={16} strokeWidth={2.25} />
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function CvPage() {
  return (
    <RequireAuth>
      <CvPageInner />
    </RequireAuth>
  );
}
