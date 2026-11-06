"use client";

import { createContext, forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Sheet } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { LoginForm } from "@/app/login/login-form";
import { useSession } from "@/lib/session";

/**
 * Sign in where you are. Features that need an account call `requireLogin(action)`: signed in, the
 * action runs now; signed out, the login modal opens over the current page and the action runs
 * right after the code is verified. No navigation to /login, so the visitor never loses the job,
 * filters or scroll position they were on. (/login stays for direct links and protected pages.)
 */

export interface LoginModalOptions {
  /** Runs once the visitor has signed in from this modal. Not run if they close it. */
  onSignedIn?: () => void;
  /** Why we're asking, shown under the title (e.g. "Sign in to save this job"). */
  reason?: string;
}

export interface LoginModalHandle {
  open: (options?: LoginModalOptions) => void;
  close: () => void;
}

export const LoginModal = forwardRef<LoginModalHandle>(function LoginModal(_props, ref) {
  const { t } = useTranslation("auth");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  // A new key per opening resets the form (email step, no stale code).
  const [session, setSession] = useState(0);
  const pending = useRef<(() => void) | undefined>(undefined);

  useImperativeHandle(
    ref,
    () => ({
      open: (options) => {
        pending.current = options?.onSignedIn;
        setReason(options?.reason);
        setSession((n) => n + 1);
        setOpen(true);
      },
      close: () => {
        pending.current = undefined;
        setOpen(false);
      },
    }),
    [],
  );

  const onSignedIn = useCallback(() => {
    const action = pending.current;
    pending.current = undefined;
    setOpen(false);
    action?.();
  }, []);

  return (
    <Sheet
      open={open}
      onClose={() => {
        pending.current = undefined;
        setOpen(false);
      }}
      title={t("title")}
      description={reason ?? t("subtitle")}
    >
      <LoginForm key={session} onSignedIn={onSignedIn} />
    </Sheet>
  );
});

interface LoginGate {
  /** Run `action` now if signed in, else ask to sign in first and run it afterwards. */
  requireLogin: (action?: () => void, options?: Omit<LoginModalOptions, "onSignedIn">) => void;
  /** Open the login modal (e.g. a "Sign in" button). */
  openLogin: (options?: LoginModalOptions) => void;
}

const LoginGateContext = createContext<LoginGate | null>(null);

/** Mounts the one login modal and exposes `requireLogin` to the whole app. */
export function LoginGateProvider({ children }: { children: ReactNode }) {
  const modal = useRef<LoginModalHandle>(null);
  const { me } = useSession();
  const signedIn = Boolean(me);
  const gate = useMemo<LoginGate>(
    () => ({
      requireLogin: (action, options) => {
        if (signedIn) action?.();
        else modal.current?.open({ ...options, onSignedIn: action });
      },
      openLogin: (options) => modal.current?.open(options),
    }),
    [signedIn],
  );
  return (
    <LoginGateContext.Provider value={gate}>
      {children}
      <LoginModal ref={modal} />
    </LoginGateContext.Provider>
  );
}

function goToLoginPage() {
  // Fallback only (no provider, so no router context to rely on); the app always has the provider.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login/";
}

/** Outside the provider (isolated component tests, an error boundary) fall back to the /login page. */
const FALLBACK_GATE: LoginGate = { requireLogin: goToLoginPage, openLogin: goToLoginPage };

export function useLoginGate(): LoginGate {
  return useContext(LoginGateContext) ?? FALLBACK_GATE;
}

/** Shorthand for `useLoginGate().requireLogin`. */
export function useRequireLogin(): LoginGate["requireLogin"] {
  return useLoginGate().requireLogin;
}
