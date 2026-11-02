"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Cv } from "@ujc/core";
import { CANDIDATE_COUNTRIES } from "@ujc/core";
import {
  Button,
  ChevronRightIcon,
  Chip,
  NavBar,
  ProgressSteps,
  TextField,
  Toggle,
} from "@ujc/ui";
import { ApiError, markOnboarded, updatePreferences } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { CvUploadCard } from "@/app/cv/cv-upload-card";

const STEPS = ["Welcome", "Your CV", "Keywords"];

function SkipLink({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="self-center text-footnote font-medium text-label-secondary hover:underline focus-ring"
    >
      Skip this step
    </button>
  );
}

function OnboardingInner() {
  const { me, refresh } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [cv, setCv] = useState<Cv | null>(me?.latestCv ?? null);
  const [aiConsentAt, setAiConsentAt] = useState<string | null>(me?.user.aiConsentAt ?? null);

  const [keywords, setKeywords] = useState<string[]>(me?.preferences.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(me?.preferences.remoteOnly ?? false);
  const [candidateCountry, setCandidateCountry] = useState(me?.preferences.candidateCountry ?? "");
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const seededCvIdRef = useRef<string | null>(null);

  // Seed the keyword editor once per CV that finishes scanning, same as /cv.
  useEffect(() => {
    if (cv?.status === "done" && seededCvIdRef.current !== cv.id) {
      seededCvIdRef.current = cv.id;
      setKeywords(cv.keywords);
    }
  }, [cv]);

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

  async function finishOnboarding(savePreferences: boolean) {
    setFinishing(true);
    setFinishError(null);
    try {
      if (savePreferences) {
        await updatePreferences({
          keywords,
          remoteOnly,
          candidateCountry: candidateCountry || null,
        });
      }
      await markOnboarded();
      await refresh();
      router.replace("/");
    } catch (err) {
      setFinishError(
        err instanceof ApiError ? err.message : "Could not finish onboarding. Please try again.",
      );
      setFinishing(false);
    }
  }

  const stepTitles = ["Let's set you up", "Upload your CV", "Confirm your keywords"] as const;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
      {/* One `h1` per step (via NavBar's large title), matching docs/design/SCREENS.md's
          accessibility note for the onboarding flow. */}
      <NavBar title={stepTitles[step]} />
      <ProgressSteps label="Onboarding progress" steps={STEPS} current={step} />

      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-label-secondary">
            In a couple of steps we&apos;ll scan your CV and find jobs that fit you. First,
            we&apos;d like your OK to send your CV to Claude, an AI model running on our host
            machine, so it can pull out your skills and keywords.
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={() => setStep(1)} className="self-start">
              Continue
            </Button>
            <SkipLink onSkip={() => setStep(1)} />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-label-secondary">
            We&apos;ll pull out your skills and keywords automatically. You can always do this
            later from My CV.
          </p>
          <CvUploadCard
            cv={cv}
            onCvChange={setCv}
            aiConsentAt={aiConsentAt}
            onConsentGranted={setAiConsentAt}
          />
          <div className="flex flex-col gap-3">
            <Button onClick={() => setStep(2)} className="self-start">
              Continue
            </Button>
            <SkipLink onSkip={() => setStep(2)} />
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-5">
          <p className="text-body text-label-secondary">
            Remove anything that doesn&apos;t fit, or add your own.
          </p>
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
          </section>

          {finishError ? (
            <p role="alert" className="text-footnote text-danger-ink">
              {finishError}
            </p>
          ) : null}

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => void finishOnboarding(true)}
              loading={finishing}
              className="self-start"
            >
              Show my jobs
            </Button>
            <SkipLink onSkip={() => void finishOnboarding(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingInner />
    </RequireAuth>
  );
}
