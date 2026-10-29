"use client";

import { useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import Link from "next/link";
import type { Cv } from "@ujc/core";
import { CANDIDATE_COUNTRIES } from "@ujc/core";
import { ApiError, getCv, updatePreferences, uploadCv } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";

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

function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return "That file is larger than 5 MB.";
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  const mimeOk = file.type ? ACCEPTED_MIME.has(file.type) : false;
  const extOk = ACCEPTED_EXTENSIONS.includes(ext);
  if (!mimeOk && !extOk) {
    return "Unsupported file type. Use PDF, PNG, JPG, WEBP, TXT or MD.";
  }
  return null;
}

function CvPageInner() {
  const { me, refresh } = useSession();
  const [cv, setCv] = useState<Cv | null>(me?.latestCv ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showWaitingNote, setShowWaitingNote] = useState(false);

  const [keywords, setKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(me?.preferences.remoteOnly ?? false);
  const [candidateCountry, setCandidateCountry] = useState(me?.preferences.candidateCountry ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const seededCvIdRef = useRef<string | null>(null);
  const trackedCvIdRef = useRef<string | null>(null);
  const scanStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDropzoneKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value || value.length > 40 || keywords.length >= 30) {
      setKeywordInput("");
      return;
    }
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
    setSavedNotice(false);
    try {
      await updatePreferences({
        keywords,
        remoteOnly,
        candidateCountry: candidateCountry || null,
      });
      await refresh();
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">Your CV</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Upload your CV once — we scan it for skills and keywords, and match you to jobs automatically.
        </p>
      </header>

      {showDropzone ? (
        <section className="flex flex-col gap-3">
          {cv?.status === "error" ? (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              We couldn&apos;t scan that CV{cv.error ? `: ${cv.error}` : "."} Try uploading it again.
            </p>
          ) : null}
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload your CV: drag and drop a file here, or press Enter to choose one"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={handleDropzoneKeyDown}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center text-sm transition-colors ${
              dragActive
                ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-900"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <p className="font-medium">Drag &amp; drop your CV here</p>
            <p className="text-zinc-500">
              or click to choose a file — PDF, PNG, JPG, WEBP, TXT or MD, up to 5 MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
          {uploadError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {uploadError}
            </p>
          ) : null}
          {uploading ? <p className="text-sm text-zinc-500">Uploading…</p> : null}
        </section>
      ) : scanning ? (
        <section className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="font-medium">Scanning your CV…</p>
          <p className="text-sm text-zinc-500">
            We&apos;re reading your CV and pulling out your skills and keywords. This usually takes
            a minute.
          </p>
          {showWaitingNote ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Still waiting for the scanner — it may be offline right now. Hang tight, this page
              will update as soon as it picks up your CV.
            </p>
          ) : null}
        </section>
      ) : cv ? (
        <section className="flex flex-col gap-5">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">{cv.profile?.headline ?? "Your profile"}</h2>
            {cv.profile?.seniority ? (
              <p className="text-sm text-zinc-500">{cv.profile.seniority}</p>
            ) : null}
            {cv.profile?.summary ? (
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{cv.profile.summary}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="keyword-input" className="text-sm font-medium">
              Keywords
            </label>
            {keywords.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {keywords.map((k) => (
                  <li
                    key={k}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => removeKeyword(k)}
                      aria-label={`Remove ${k}`}
                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No keywords yet — add some below.</p>
            )}
            <input
              id="keyword-input"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="Add a keyword and press Enter"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
            />
            Remote jobs only
          </label>

          <div className="flex flex-col gap-1">
            <label htmlFor="candidate-country" className="text-sm font-medium">
              I&apos;m based in
            </label>
            <select
              id="candidate-country"
              value={candidateCountry ?? ""}
              onChange={(e) => setCandidateCountry(e.target.value)}
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Select a country…</option>
              {CANDIDATE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {saveError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {saveError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {savedNotice ? (
              <span role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
                Saved
              </span>
            ) : null}
            <Link
              href="/"
              className="ml-auto rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              See my jobs →
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function CvPage() {
  return (
    <RequireAuth>
      <CvPageInner />
    </RequireAuth>
  );
}
