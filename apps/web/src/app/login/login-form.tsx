"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@/lib/api";
import { requestOtp, verifyOtp } from "@/lib/api";
import { useSession } from "@/lib/session";

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

const inputClass =
  "rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryButtonClass =
  "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const router = useRouter();
  const { refresh } = useSession();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const [sendingEmail, setSendingEmail] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
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
      setDigits(Array(CODE_LENGTH).fill(""));
      setResendIn(RESEND_SECONDS);
      setTimeout(() => inputRefs.current[0]?.focus(), 0);
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

  async function verify(code: string) {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setCodeError(null);
    setVerifying(true);
    try {
      await verifyOtp(email, code);
      const me = await refresh();
      if (next) {
        router.replace(next);
      } else if (!me?.latestCv) {
        router.replace("/cv/");
      } else {
        router.replace("/");
      }
    } catch (err) {
      setCodeError(errorMessage(err));
      setVerifying(false);
      verifyingRef.current = false;
    }
  }

  function handleDigitChange(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    setDigits((prev) => {
      const next = [...prev];
      next[index] = clean ? (clean[clean.length - 1] ?? "") : "";
      return next;
    });
    if (clean && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!text) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < text.length; i++) next[i] = text[i] ?? "";
    setDigits(next);
    inputRefs.current[Math.min(text.length, CODE_LENGTH - 1)]?.focus();
  }

  function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    const code = digits.join("");
    if (code.length === CODE_LENGTH) void verify(code);
  }

  // Auto-submit once all 6 digits are present (typed or pasted).
  useEffect(() => {
    const code = digits.join("");
    // `verify` is the user-facing action this effect exists to trigger; its own setState calls
    // (verifying/codeError) are how the form reflects that an in-flight request started.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code.length === CODE_LENGTH) void verify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          We&apos;ll email you a 6-digit code — no password needed.
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={handleEmailSubmit} aria-label="Sign in with email" className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          {emailError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {emailError}
            </p>
          ) : null}
          <button type="submit" disabled={sendingEmail} className={primaryButtonClass}>
            {sendingEmail ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} aria-label="Enter your code" className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Enter the 6-digit code we sent to <strong>{email}</strong>.
          </p>
          {devCode ? (
            <p
              role="status"
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              Review mode code: {devCode}
            </p>
          ) : null}
          <div role="group" aria-label="6-digit code" className="flex gap-2">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                value={digit}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
                className="h-12 w-10 rounded-xl border border-zinc-300 text-center text-lg dark:border-zinc-700 dark:bg-zinc-900"
              />
            ))}
          </div>
          {codeError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {codeError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={verifying || digits.join("").length !== CODE_LENGTH}
            className={primaryButtonClass}
          >
            {verifying ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendIn > 0 || sendingEmail}
            className="text-sm text-zinc-600 underline disabled:no-underline disabled:opacity-50 dark:text-zinc-400"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCodeError(null);
            }}
            className="self-start text-xs text-zinc-500 underline"
          >
            Use a different email
          </button>
        </form>
      )}
    </main>
  );
}
