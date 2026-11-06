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
  /** Where "Sign in" goes (the widget appends nothing; pass `?next=` yourself if you want it). */
  signInHref?: string;
  /** The contributor board page, linked from the widget. */
  boardHref?: string;
  /** Router-aware link (e.g. Next's `Link`). Default: a plain `<a>`. */
  linkAs?: LinkComponent;
}

interface ContributorValue extends Required<Omit<ContributorConfig, "signInHref" | "boardHref">> {
  signInHref: string | null;
  boardHref: string | null;
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
    signInHref: config.signInHref ?? null,
    boardHref: config.boardHref ?? null,
    linkAs: config.linkAs ?? PlainLink,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useContributor(): ContributorValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useContributor must be used inside <ContributorProvider>");
  return value;
}
