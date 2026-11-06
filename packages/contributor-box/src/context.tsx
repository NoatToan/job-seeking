"use client";

import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";
import type { FeedbackApi } from "./api";
import { strings as builtIn, type ContributorStrings } from "./strings";

export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
}>;

export interface ContributorConfig {
  api: FeedbackApi;
  strings?: ContributorStrings;
  /** Whether a session exists. The server still checks every call; this only picks the UI. */
  signedIn: boolean;
  /**
   * Let signed-out visitors send feedback (with an optional name). The server must opt in too
   * (`create_feedback_router(..., allow_anonymous=True)`). Default false: they are asked to sign in.
   */
  allowAnonymous?: boolean;
  /**
   * Sign the visitor in where they are (e.g. the host's login modal) instead of navigating to
   * `signInHref`. Every "Sign in to vote / comment / follow it" control calls it; `resume`, when
   * given, repeats what the visitor was doing (the vote they clicked) once they have signed in.
   * Without it those controls are links to `signInHref`.
   */
  onRequireSignIn?: (resume?: () => void) => void;
  /** Where "Sign in" goes (the widget appends nothing; pass `?next=` yourself if you want it). */
  signInHref?: string;
  /** The contributor board page, linked from the widget. */
  boardHref?: string;
  /** The public roadmap page, linked from the widget's "sent" view (also for guests). */
  roadmapHref?: string;
  /** Router-aware link (e.g. Next's `Link`). Default: a plain `<a>`. */
  linkAs?: LinkComponent;
}

interface ContributorValue
  extends Required<Omit<ContributorConfig, "signInHref" | "boardHref" | "roadmapHref" | "onRequireSignIn">> {
  signInHref: string | null;
  boardHref: string | null;
  roadmapHref: string | null;
  onRequireSignIn: ((resume?: () => void) => void) | null;
}

const Ctx = createContext<ContributorValue | null>(null);

const PlainLink: LinkComponent = ({ href, className, children, onClick }) => (
  <a href={href} className={className} onClick={onClick}>
    {children}
  </a>
);

export function ContributorProvider({ children, ...config }: ContributorConfig & { children: ReactNode }) {
  const value: ContributorValue = {
    api: config.api,
    strings: config.strings ?? builtIn.en,
    signedIn: config.signedIn,
    allowAnonymous: config.allowAnonymous ?? false,
    onRequireSignIn: config.onRequireSignIn ?? null,
    signInHref: config.signInHref ?? null,
    boardHref: config.boardHref ?? null,
    roadmapHref: config.roadmapHref ?? null,
    linkAs: config.linkAs ?? PlainLink,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useContributor(): ContributorValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useContributor must be used inside <ContributorProvider>");
  return value;
}

/** Whether a "sign in" control can be shown at all (an in-place prompt or a sign-in page). */
export function useCanAskToSignIn(): boolean {
  const { onRequireSignIn, signInHref } = useContributor();
  return Boolean(onRequireSignIn || signInHref);
}

/**
 * "Sign in to …": a button that calls the host's `onRequireSignIn(resume)` when there is one,
 * else a link to `signInHref`, else nothing.
 */
export function SignInAction({
  className,
  children,
  resume,
  onClick,
  title,
}: {
  className?: string;
  children: ReactNode;
  /** What to do once signed in (only with `onRequireSignIn`). */
  resume?: () => void;
  /** Also run on click (e.g. close a panel), before asking to sign in. */
  onClick?: () => void;
  title?: string;
}) {
  const { onRequireSignIn, signInHref, linkAs: Link } = useContributor();
  if (onRequireSignIn) {
    return (
      <button
        type="button"
        className={className}
        title={title}
        onClick={() => {
          onClick?.();
          onRequireSignIn(resume);
        }}
      >
        {children}
      </button>
    );
  }
  if (!signInHref) return null;
  return (
    <Link href={signInHref} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
