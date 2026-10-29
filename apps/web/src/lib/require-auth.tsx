"use client";

import type { ReactNode } from "react";
import { useSession } from "./session";

/**
 * Gates a page behind a signed-in session. The actual redirect to `/login/?next=...` happens
 * centrally in `SessionProvider`'s 401 handler (every API call goes through it, not just the
 * initial load), so this component only needs to reflect the current state: a loading
 * placeholder, a retryable error, or (while redirecting) nothing.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, error, refresh } = useSession();

  if (loading) {
    return <p className="px-4 py-8 text-sm text-zinc-500">Checking your session…</p>;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="mx-4 mt-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        <p>Could not check your session: {error.message}</p>
        <button type="button" onClick={() => void refresh()} className="mt-2 underline">
          Try again
        </button>
      </div>
    );
  }

  if (!me) return null;

  return <>{children}</>;
}
