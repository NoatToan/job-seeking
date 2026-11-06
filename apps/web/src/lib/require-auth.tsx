"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "./session";

/**
 * Gates a page behind a signed-in session. The actual redirect to `/login/?next=...` happens
 * centrally in `SessionProvider`'s 401 handler (every API call goes through it, not just the
 * initial load), so this component only needs to reflect the current state: a loading
 * placeholder, a retryable error, or (while redirecting) nothing.
 *
 * `fallback`: the page's own skeleton (same blocks as the loaded screen) shown while the session
 * check runs. Without one, an empty busy region — never a text spinner.
 */
export function RequireAuth({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { me, loading, error, refresh } = useSession();
  const { t } = useTranslation("home");

  if (loading) {
    return fallback ?? <div aria-busy="true" aria-label={t("requireAuth.checking")} className="min-h-dvh" />;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="mx-4 mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        <p>{t("requireAuth.errorMessage", { message: error.message })}</p>
        <button type="button" onClick={() => void refresh()} className="mt-2 underline">
          {t("common:tryAgain")}
        </button>
      </div>
    );
  }

  if (!me) return null;

  return <>{children}</>;
}
