"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { Cv } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  ChevronRightIcon,
  FuzzySelect,
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
import type { SelectOption } from "@ujc/ui";
import type { TFunction } from "i18next";
import { ApiError, deleteCv, listCvs, updatePreferences, uploadCv } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { useLanguage } from "@/lib/i18n/provider";
import { AccountMenu } from "@/app/nav";
import { candidateCountryOptions } from "@/app/country-filter";
import { ACCEPT_ATTR, CvUploadCard, validateFile } from "./cv-upload-card";

/** Status chip for a row in the CV list (docs/product issue M4-04 flow-v2 adaptation). */
function cvStatusBadge(status: Cv["status"], t: TFunction<"cv">) {
  switch (status) {
    case "done":
      return <Badge tone="success">{t("status.ready")}</Badge>;
    case "error":
      return <Badge tone="danger">{t("status.failed")}</Badge>;
    case "processing":
      return (
        <Badge tone="tint" icon={<Spinner size={12} />}>
          {t("status.scanning")}
        </Badge>
      );
    default:
      return <Badge>{t("status.queued")}</Badge>;
  }
}

// Digest hour options (M4-08): a local hour (0-23) in the user's digestTz, labelled in 12h form.
/** Every hour of the day; "7", "07:00" and "19:00" all find their row. */
const DIGEST_HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }),
  keywords: [String(hour), `${String(hour).padStart(2, "0")}:00`],
}));

function CvPageInner() {
  const { t } = useTranslation("cv");
  const { dateLocale } = useLanguage();
  const { me, refresh } = useSession();
  const toast = useToast();
  const ONBOARDING_STEPS = [t("steps.signIn"), t("steps.yourCv"), t("steps.keywords")];
  const [cv, setCv] = useState<Cv | null>(me?.latestCv ?? null);

  const [keywords, setKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(me?.preferences.remoteOnly ?? false);
  const [candidateCountry, setCandidateCountry] = useState(me?.preferences.candidateCountry ?? "");
  const countryOptions = candidateCountryOptions(t("location.selectCountry"));
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
      toast.show({ tone: "success", title: t("toast.cvDeletedTitle"), message: t("toast.cvDeletedMessage") });
    } catch (err) {
      toast.show({
        tone: "error",
        title: t("toast.deleteFailedTitle"),
        message: err instanceof ApiError ? err.message : t("errors.pleaseTryAgain"),
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
      toast.show({ tone: "error", title: t("toast.uploadRejectedTitle"), message: validationError });
      return;
    }
    try {
      const created = await uploadCv(file);
      setCv(created);
    } catch (err) {
      toast.show({
        tone: "error",
        title: t("toast.uploadAnotherFailedTitle"),
        message: err instanceof ApiError ? err.message : t("errors.pleaseTryAgain"),
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
      setKeywordError(t("keywordError.tooLong"));
      return;
    }
    if (keywords.length >= 30) {
      setKeywordError(t("keywordError.tooMany"));
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
      toast.show({ tone: "success", title: t("toast.savedTitle"), message: t("toast.savedMessage") });
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t("saveError.fallback"));
    } finally {
      setSaving(false);
    }
  }

  const showProgressSteps = isFirstRun && !keywordsEverSaved;

  return (
    <>
      <NavBar title={t("nav.title")} trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
        {showProgressSteps ? (
          <ProgressSteps label={t("progress.setupLabel")} steps={ONBOARDING_STEPS} current={cv?.status === "done" ? 2 : 1} />
        ) : null}

        <p className="text-body text-label-secondary">{t("intro")}</p>

        <CvUploadCard
          cv={cv}
          onCvChange={setCv}
          aiConsentAt={aiConsentAt}
          onConsentGranted={setAiConsentAt}
        />

        {cv?.status === "done" ? (
          <div className="flex flex-col gap-5 animate-pop-in">
            <div className="flex flex-col gap-2">
              <h2 className="text-title2 text-label">{t("found.title")}</h2>
              <p className="text-body text-label-secondary">{t("found.subtitle")}</p>
              {keywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((k) => (
                    <Chip key={k} onRemove={() => removeKeyword(k)}>
                      {k}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-subheadline text-label-secondary">{t("found.addAtLeastOne")}</p>
              )}
              <TextField
                id="keyword-input"
                label={t("keywordsField.label")}
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
                placeholder={t("keywordsField.placeholder")}
                error={keywordError ?? undefined}
              />
            </div>

            <section aria-label={t("location.ariaLabel")} className="flex flex-col gap-1.5">
              <h3 className="px-1 text-footnote font-normal uppercase tracking-wide text-label-secondary">
                {t("location.ariaLabel")}
              </h3>
              <div className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex-1 text-body text-label">{t("location.remoteOnly")}</span>
                  <Toggle label={t("location.remoteOnly")} checked={remoteOnly} onChange={setRemoteOnly} />
                </div>
                <div className="relative flex min-h-11 items-center gap-3 px-4 py-0 hairline-t transition-colors duration-150 focus-within:bg-fill-tertiary">
                  <span aria-hidden className="flex-1 text-body text-label">{t("location.basedIn")}</span>
                  <FuzzySelect
                    id="candidate-country"
                    name="candidateCountry"
                    variant="row"
                    label={t("location.basedIn")}
                    value={candidateCountry ?? ""}
                    onChange={setCandidateCountry}
                    options={countryOptions}
                    placeholder={t("location.selectCountry")}
                    className="min-w-0"
                  />
                </div>
              </div>
              <p className="px-4 text-footnote text-label-secondary">{t("location.hint")}</p>
            </section>

            <section aria-label={t("digest.ariaLabel")} className="flex flex-col gap-1.5">
              <h3 className="px-1 text-footnote font-normal uppercase tracking-wide text-label-secondary">
                {t("digest.ariaLabel")}
              </h3>
              <div className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
                <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                  <span className="flex-1 text-body text-label">{t("digest.emailMe")}</span>
                  <Toggle
                    label={t("digest.emailMe")}
                    checked={digestEnabled}
                    onChange={setDigestEnabled}
                  />
                </div>
                {digestEnabled ? (
                  <div className="relative flex min-h-11 items-center gap-3 px-4 py-0 hairline-t transition-colors duration-150 focus-within:bg-fill-tertiary">
                    <span aria-hidden className="flex-1 text-body text-label">{t("digest.sendAround")}</span>
                    <FuzzySelect
                      id="digest-hour"
                      name="digestHour"
                      variant="row"
                      label={t("digest.sendAround")}
                      value={String(digestHour)}
                      onChange={(v) => setDigestHour(Number(v))}
                      options={DIGEST_HOUR_OPTIONS}
                    />
                  </div>
                ) : null}
              </div>
              <p className="px-4 text-footnote text-label-secondary">{t("digest.hint")}</p>
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
                {t("actions.save")}
              </Button>
              <Link
                href="/"
                className="ml-auto inline-flex h-11 items-center gap-1 rounded-control px-1 text-body font-semibold text-tint hover:underline focus-ring"
              >
                {t("actions.seeMyJobs")}
                <ChevronRightIcon size={16} strokeWidth={2.25} />
              </Link>
            </div>
          </div>
        ) : null}

        {cvItems.length > 0 ? (
          <section aria-label={t("yourCvs.ariaLabel")} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-title3 text-label">{t("yourCvs.ariaLabel")}</h2>
              <button
                type="button"
                onClick={() => uploadAnotherInputRef.current?.click()}
                className={buttonClasses({ variant: "plain", size: "sm" })}
              >
                <UploadIcon size={16} />
                {t("yourCvs.uploadAnother")}
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
                      {t("yourCvs.uploadedOn", {
                        date: new Date(item.createdAt).toLocaleDateString(dateLocale),
                      })}
                    </p>
                  </div>
                  {cvStatusBadge(item.status, t)}
                  {confirmingDeleteId === item.id ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="destructive"
                        size="sm"
                        loading={deletingId === item.id}
                        onClick={() => void handleDeleteCv(item.id)}
                      >
                        {t("yourCvs.confirm")}
                      </Button>
                      <Button variant="plain" size="sm" onClick={() => setConfirmingDeleteId(null)}>
                        {t("yourCvs.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <IconButton
                      label={t("yourCvs.deleteAria", { filename: item.filename })}
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
