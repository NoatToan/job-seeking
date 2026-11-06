"use client";

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ContributorProvider,
  createFeedbackApi,
  strings,
  type LinkComponent,
  type Request,
} from "@contributor-box/react";
import { API_BASE_URL, apiFetch, ensureCsrfCookie } from "./api";
import { useLoginGate } from "./login-modal";
import { useSession } from "./session";

/** Signed-out visitors can send feedback and comment (anonymous, D14), so an unsafe call first
 * makes sure the CSRF cookie exists; signed-in users already have it from sign-in. */
const feedbackRequest: Request = async (path, init) => {
  if (init?.method && init.method.toUpperCase() !== "GET") await ensureCsrfCookie();
  return apiFetch(path, init);
};

/** Contributor feature (docs/product/ARCHITECTURE.md D14): the vendored contributor-box UI, on
 * job-seeking's own transport (`apiFetch`: cookies, CSRF header, 401 handling) and session. */
const feedbackApi = createFeedbackApi(feedbackRequest, { baseUrl: API_BASE_URL });

export function ContributorRoot({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { i18n, t } = useTranslation("contributor");
  const { openLogin } = useLoginGate();
  const pathname = usePathname() ?? "/";
  const language = i18n.resolvedLanguage === "vi" ? "vi" : "en";
  // Fallback only: every contributor "Sign in to …" control uses the login modal below.
  const signInHref = useMemo(() => `/login/?next=${encodeURIComponent(pathname)}`, [pathname]);
  // Sign in where you are (the app's login modal); `resume` repeats the vote the visitor clicked.
  const onRequireSignIn = useCallback(
    (resume?: () => void) => openLogin({ reason: t("auth.reason"), onSignedIn: resume }),
    [openLogin, t],
  );
  return (
    <ContributorProvider
      api={feedbackApi}
      strings={strings[language]}
      signedIn={Boolean(me)}
      allowAnonymous
      onRequireSignIn={onRequireSignIn}
      signInHref={signInHref}
      boardHref="/contribute/"
      roadmapHref="/roadmap/"
      linkAs={Link as LinkComponent}
    >
      {children}
    </ContributorProvider>
  );
}

/** Whether the signed-in user may open the admin screens. The API enforces it on every call. */
export function useIsAdmin(): boolean {
  const { me } = useSession();
  return me?.user.role === "admin";
}
