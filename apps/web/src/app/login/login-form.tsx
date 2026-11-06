"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { ApiError } from "@/lib/api";
import { requestOtp, verifyOtp } from "@/lib/api";
import { useSession } from "@/lib/session";
import { BrandMark, Button, Card, ChevronLeftIcon, CodeField, InfoIcon, TextField } from "@ujc/ui";

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "invalid_code":
        return "That code isn't right. Check it and try again.";
      case "code_expired":
        return "This code has expired. Request a new one.";
      case "too_many_attempts":
        return "Too many attempts on this code. Request a new one to keep going.";
      default:
        if (err.status === 429) return "Too many requests. Please wait a moment and try again.";
        return err.message;
    }
  }
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

export function LoginForm() {
  // Only same-site paths: `?next=https://evil.example` must not turn sign-in into an open redirect.
  const [nextParam] = useQueryState("next");
  const next = nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const router = useRouter();
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
      setEmailError(errorMessage(err));
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
      setCodeError(errorMessage(err));
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
        <BrandMark name="JobSeeking" />

        {step === "email" ? (
          <>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-large-title text-label font-display">Find work you&apos;ll love</h1>
              <p className="text-body text-label-secondary">
                Enter your email and we&apos;ll send you a 6-digit code. No password needed.
              </p>
            </div>
            <Card padding="lg" className="w-full">
              <form onSubmit={handleEmailSubmit} aria-label="Sign in with email" className="flex flex-col gap-4">
                <TextField
                  label="Email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={emailError ?? undefined}
                />
                <Button type="submit" size="lg" fullWidth loading={sendingEmail}>
                  Continue
                </Button>
              </form>
            </Card>
            <p className="max-w-xs text-center text-footnote text-label-secondary">
              By continuing you agree to our Terms and{" "}
              <Link href="/privacy/" className="font-medium text-tint hover:underline focus-ring">
                Privacy notice
              </Link>
              .
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
              Use a different email
            </Button>

            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-title1 text-label">Check your email</h1>
              <p className="text-body text-label-secondary">
                We sent a code to <strong className="font-semibold text-label">{email}</strong>. It works for
                10 minutes.
              </p>
            </div>

            {devCode ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-card bg-info-soft px-4 py-3 text-subheadline font-medium text-info-ink"
              >
                <InfoIcon size={18} />
                <span>
                  Preview mode: your code is <span className="tabular-nums">{devCode}</span>
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
                Sign in
              </Button>
            </form>

            <div className="flex flex-col items-center gap-1">
              <p className="text-footnote text-label-secondary">Didn&apos;t get it?</p>
              <Button type="button" variant="plain" size="sm" disabled={resendIn > 0 || sendingEmail} onClick={handleResend}>
                {resendIn > 0 ? `Send a new code (${resendIn}s)` : "Send a new code"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
