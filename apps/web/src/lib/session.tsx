"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MeResponse } from "@ujc/core";
import { ApiError, getMe, logout as apiLogout, setUnauthorizedHandler } from "./api";
import { isPublicRoute } from "./public-routes";
import { clearViewCache } from "./view-cache";

export interface SessionValue {
  /** `null` while loading, or once we know the visitor isn't signed in. */
  me: MeResponse | null;
  loading: boolean;
  /** Set only for unexpected failures (network, 5xx) — a 401 just leaves `me` as `null`. */
  error: Error | null;
  /** Re-fetches `GET /api/me` and returns the fresh value (or `null` on failure). */
  refresh: () => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
  /** Optimistic local edit of the signed-in user (e.g. a new display name before the PATCH
   * returns). No-op while signed out. Callers revert by mutating back on failure. */
  mutate: (update: (me: MeResponse) => MeResponse) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Loads the signed-in user once on mount and exposes it to the app. Also registers the global
 * 401 handler (see `apiFetch`/`setUnauthorizedHandler`) so that *any* API call that comes back
 * unauthorized — not just the initial load — clears the session and redirects to
 * `/login/?next=<current path>`.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const refresh = useCallback(async (): Promise<MeResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMe();
      setMe(data);
      return data;
    } catch (err) {
      setMe(null);
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount-only: re-fetching on every `refresh` identity change would loop, and the resulting
    // setState calls are what synchronize this component with the server-held session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setMe(null);
      setLoading(false);
      // A public page (home, job detail) expects to work signed out — most visibly, the initial
      // `GET /api/me` check above always 401s for an anonymous visitor there, and that must not
      // bounce them to /login. Only a 401 on an actually-protected page redirects.
      if (pathnameRef.current.startsWith("/login") || isPublicRoute(pathnameRef.current)) return;
      const search = typeof window !== "undefined" ? window.location.search : "";
      const next = encodeURIComponent(pathnameRef.current + search);
      router.replace(`/login/?next=${next}`);
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Clear local state regardless of whether the network call succeeded.
    } finally {
      // Cached feed pages / job details belong to the previous user.
      clearViewCache();
      setMe(null);
      router.replace("/login/");
    }
  }, [router]);

  const mutate = useCallback((update: (me: MeResponse) => MeResponse) => {
    setMe((current) => (current ? update(current) : current));
  }, []);

  return (
    <SessionContext.Provider value={{ me, loading, error, refresh, signOut, mutate }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
