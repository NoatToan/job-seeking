"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api";
import { requestOtp, verifyOtp } from "@/lib/api";
import { useSession } from "@/lib/session";
import { BrandMark, Button, Card, ChevronLeftIcon, CodeField, InfoIcon, TextField } from "@ujc/ui";

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

function errorMessage(err: unknown, t: TFunction<"auth">): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "invalid_code":
        return t("errors.invalidCode");
      case "code_expired":
        return t("errors.codeExpired");
      case "too_many_attempts":
        return t("errors.tooManyAttempts");
      default:
        if (err.status === 429) return t("errors.tooManyRequests");
        return err.message;
    }
  }
  return err instanceof Error ? err.message : t("errors.generic");
}

export function LoginForm() {
  // Only same-site paths: `?next=https://evil.example` must not turn sign-in into an open redirect.
  const [nextParam] = useQueryState("next");
  const next = nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const router = useRouter();
  const { t } = useTranslation("auth");
  const { refresh } = useSession();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  async function sendCode(targetEmail: string) {
    setEmailError(null);
    setCodeError(null);
    setSendingEmail(true);
    try {
      const res = await requestOtp(targetEmail);
      setDevCode(res.devCode ?? null);
      setStep("code");
      setCode("");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setEmailError(errorMessage(err, t));
    } finally {
      setSendingEmail(false);
    }
  }

  function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setEmail(trimmed);
    void sendCode(trimmed);
  }

  function handleResend() {
    if (resendIn > 0 || sendingEmail) return;
    void sendCode(email);
  }

  async function verify(value: string) {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setCodeError(null);
    setVerifying(true);
    try {
      await verifyOtp(email, value);
      const me = await refresh();
      if (next) {
        router.replace(next);
      } else if (!me?.user.onboardedAt) {
        router.replace("/onboarding/");
      } else {
        router.replace("/");
      }
    } catch (err) {
      setCodeError(errorMessage(err, t));
      setCode("");
      setVerifying(false);
      verifyingRef.current = false;
    }
  }

  function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length === CODE_LENGTH) void verify(code);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-6">
        {/* The login screen has no app chrome, so it carries its own way back. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 self-start rounded-control px-1 py-1 text-subheadline font-medium text-tint hover:underline focus-ring"
        >
          <ChevronLeftIcon size={16} strokeWidth={2.25} aria-hidden />
          {t("backHome")}
        </Link>
        <Link href="/" aria-label={t("backHome")} className="rounded-control focus-ring">
          <BrandMark name="JobSeeking" />
        </Link>

        {step === "email" ? (
          <>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-large-title text-label font-display">{t("title")}</h1>
              <p className="text-body text-label-secondary">
                {t("subtitle")}
              </p>
            </div>
            <Card padding="lg" className="w-full">
              <form onSubmit={handleEmailSubmit} aria-label={t("formAriaLabel")} className="flex flex-col gap-4">
                <TextField
                  label={t("emailLabel")}
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={emailError ?? undefined}
                />
                <Button type="submit" size="lg" fullWidth loading={sendingEmail}>
                  {t("continue")}
                </Button>
              </form>
            </Card>
            <p className="max-w-xs text-center text-footnote text-label-secondary">
              <Trans
                t={t}
                i18nKey="agreeTerms"
                components={{
                  privacyLink: <Link href="/privacy/" className="font-medium text-tint hover:underline focus-ring" />,
                }}
              />
            </p>
          </>
        ) : (
          <div className="flex w-full flex-col gap-5">
            <Button
              type="button"
              variant="plain"
              size="sm"
              icon={<ChevronLeftIcon size={18} />}
              className="self-start"
              onClick={() => {
                setStep("email");
                setCode("");
                setCodeError(null);
              }}
            >
              {t("useDifferentEmail")}
            </Button>

            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-title1 text-label">{t("checkEmailTitle")}</h1>
              <p className="text-body text-label-secondary">
                <Trans
                  t={t}
                  i18nKey="codeSentTo"
                  values={{ email }}
                  components={{ strong: <strong className="font-semibold text-label" /> }}
                />
              </p>
            </div>

            {devCode ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-card bg-info-soft px-4 py-3 text-subheadline font-medium text-info-ink"
              >
                <InfoIcon size={18} />
                <span>
                  <Trans
                    t={t}
                    i18nKey="previewMode"
                    values={{ code: devCode }}
                    components={{ code: <span className="tabular-nums" /> }}
                  />
                </span>
              </div>
            ) : null}

            <form onSubmit={handleCodeSubmit} className="flex flex-col items-center gap-4">
              <CodeField
                value={code}
                onChange={setCode}
                onComplete={(value) => void verify(value)}
                error={Boolean(codeError)}
                disabled={verifying}
                autoFocus
              />
              {codeError ? (
                <p role="alert" className="text-footnote text-danger-ink">
                  {codeError}
                </p>
              ) : null}
              <Button type="submit" size="lg" fullWidth loading={verifying} disabled={code.length !== CODE_LENGTH}>
                {t("signIn")}
              </Button>
            </form>

            <div className="flex flex-col items-center gap-1">
              <p className="text-footnote text-label-secondary">{t("didntGetIt")}</p>
              <Button type="button" variant="plain" size="sm" disabled={resendIn > 0 || sendingEmail} onClick={handleResend}>
                {resendIn > 0 ? t("sendNewCodeIn", { seconds: resendIn }) : t("sendNewCode")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
