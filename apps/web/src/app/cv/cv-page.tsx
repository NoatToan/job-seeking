"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Cv } from "@ujc/core";
import { CANDIDATE_COUNTRIES } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  ChevronRightIcon,
  Chip,
  DocumentIcon,
  IconButton,
  NavBar,
  ProgressSteps,
  Spinner,
  TextField,
  Toggle,
  TrashIcon,
  UploadIcon,
  useToast,
} from "@ujc/ui";
import { ApiError, deleteCv, listCvs, updatePreferences, uploadCv } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { AccountMenu } from "@/app/nav";
import { ACCEPT_ATTR, CvUploadCard, validateFile } from "./cv-upload-card";

/** Status chip for a row in the CV list (docs/product issue M4-04 flow-v2 adaptation). */
function cvStatusBadge(status: Cv["status"]) {
  switch (status) {
    case "done":
      return <Badge tone="success">Ready</Badge>;
    case "error":
      return <Badge tone="danger">Failed</Badge>;
    case "processing":
      return (
        <Badge tone="tint" icon={<Spinner size={12} />}>
          Scanning
        </Badge>
      );
    default:
      return <Badge>In queue</Badge>;
  }
}

// Digest hour options (M4-08): a local hour (0-23) in the user's digestTz, labelled in 12h form.
const DIGEST_HOURS = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  label: new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }),
}));

const ONBOARDING_STEPS = ["Sign in", "Your CV", "Keywords"];

function CvPageInner() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const [cv, setCv] = useState<Cv | null>(me?.latestCv ?? null);

  const [keywords, setKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(me?.preferences.remoteOnly ?? false);
  const [candidateCountry, setCandidateCountry] = useState(me?.preferences.candidateCountry ?? "");
  const [digestEnabled, setDigestEnabled] = useState(me?.preferences.digestEnabled ?? true);
  const [digestHour, setDigestHour] = useState(me?.preferences.digestHour ?? 7);
  // Not user-editable yet (no timezone picker in this MVP) — carried through unchanged so Save
  // doesn't reset it back to the API default.
  const digestTz = me?.preferences.digestTz ?? "Asia/Ho_Chi_Minh";
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keywordsEverSaved, setKeywordsEverSaved] = useState((me?.preferences.keywords.length ?? 0) > 0);

  const [aiConsentAt, setAiConsentAt] = useState<string | null>(me?.user.aiConsentAt ?? null);

  // "Your CVs" management list (M4-04): every CV the user has uploaded, with status + delete.
  const cvsApi = useApi(() => listCvs(), []);
  const [cvItems, setCvItems] = useState<Cv[]>([]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const uploadAnotherInputRef = useRef<HTMLInputElement | null>(null);

  const seededCvIdRef = useRef<string | null>(null);
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

  // Seeds `cvItems` from the one-shot `GET /api/cvs` list; subsequent changes (delete, the sync
  // effect below) update `cvItems` directly rather than refetching.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cvsApi.data) setCvItems(cvsApi.data.items);
  }, [cvsApi.data]);

  // Keeps the actively-tracked CV (uploaded just now, or polled by CvUploadCard) in sync with
  // the list, so a fresh upload or a status change (queued -> done) shows up without a refetch.
  useEffect(() => {
    if (!cv) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCvItems((prev) =>
      prev.some((c) => c.id === cv.id) ? prev.map((c) => (c.id === cv.id ? cv : c)) : [cv, ...prev],
    );
  }, [cv]);

  async function handleDeleteCv(id: string) {
    setDeletingId(id);
    try {
      await deleteCv(id);
      setCvItems((prev) => prev.filter((c) => c.id !== id));
      if (cv?.id === id) setCv(null);
      toast.show({ tone: "success", title: "CV deleted", message: "Removed from your account." });
    } catch (err) {
      toast.show({
        tone: "error",
        title: "Couldn't delete this CV",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  // Upload another CV from the "Your CVs" list (independent of CvUploadCard's own dropzone,
  // which only renders while there's no CV yet or the current one errored).
  async function handleUploadAnother(file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      toast.show({ tone: "error", title: "Couldn't upload", message: validationError });
      return;
    }
    try {
      const created = await uploadCv(file);
      setCv(created);
    } catch (err) {
      toast.show({
        tone: "error",
        title: "Couldn't upload your CV",
        message: err instanceof ApiError ? err.message : "Please try again.",
      });
    }
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
        digestEnabled,
        digestHour,
        digestTz,
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

        <CvUploadCard
          cv={cv}
          onCvChange={setCv}
          aiConsentAt={aiConsentAt}
          onConsentGranted={setAiConsentAt}
        />

        {cv?.status === "done" ? (
          <div className="flex flex-col gap-5 animate-pop-in">
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

            <section aria-label="Daily digest" className="flex flex-col gap-1.5">
              <h3 className="px-1 text-footnote font-normal uppercase tracking-wide text-label-secondary">
                Daily digest
              </h3>
              <div className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex-1 text-body text-label">Email me new matches</span>
                  <Toggle
                    label="Email me new matches"
                    checked={digestEnabled}
                    onChange={setDigestEnabled}
                  />
                </div>
                {digestEnabled ? (
                  <label className="relative flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 hairline-t transition-colors duration-150 hover:bg-fill-tertiary focus-within:bg-fill-tertiary">
                    <span className="flex-1 text-body text-label">Send around</span>
                    <select
                      id="digest-hour"
                      value={digestHour}
                      onChange={(e) => setDigestHour(Number(e.target.value))}
                      className="appearance-none rounded-control-sm bg-transparent text-right text-body text-label-secondary focus-ring"
                    >
                      {DIGEST_HOURS.map((h) => (
                        <option key={h.hour} value={h.hour}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                    <ChevronRightIcon size={16} strokeWidth={2.25} className="shrink-0 text-label-quaternary" />
                  </label>
                ) : null}
              </div>
              <p className="px-4 text-footnote text-label-secondary">
                At most once a day, with up to 10 new matches. Never for Upwork. You can
                unsubscribe from any digest email.
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

        {cvItems.length > 0 ? (
          <section aria-label="Your CVs" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-title3 text-label">Your CVs</h2>
              <button
                type="button"
                onClick={() => uploadAnotherInputRef.current?.click()}
                className={buttonClasses({ variant: "plain", size: "sm" })}
              >
                <UploadIcon size={16} />
                Upload another
              </button>
              <input
                ref={uploadAnotherInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadAnother(file);
                  e.target.value = "";
                }}
              />
            </div>
            <ul aria-live="polite" className="flex flex-col gap-2">
              {cvItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-card bg-grouped-secondary p-3 shadow-card"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-icon bg-fill-tertiary text-label-secondary">
                    <DocumentIcon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-label">{item.filename}</p>
                    <p className="text-footnote text-label-secondary">
                      Uploaded {new Date(item.createdAt).toLocaleDateString("en-AU")}
                    </p>
                  </div>
                  {cvStatusBadge(item.status)}
                  {confirmingDeleteId === item.id ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="destructive"
                        size="sm"
                        loading={deletingId === item.id}
                        onClick={() => void handleDeleteCv(item.id)}
                      >
                        Confirm
                      </Button>
                      <Button variant="plain" size="sm" onClick={() => setConfirmingDeleteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <IconButton
                      label={`Delete ${item.filename}`}
                      icon={<TrashIcon size={16} />}
                      variant="plain"
                      size="sm"
                      onClick={() => setConfirmingDeleteId(item.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
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
