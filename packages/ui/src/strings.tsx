"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Words the shared components print themselves (default labels, relative dates, fit bands).
 * The package stays i18n-library-free so it can be reused by the Expo app: it ships English and
 * the app passes its translations through `UiStringsProvider` (apps/web: `I18nProvider`).
 */
export interface UiStrings {
  /** BCP 47 tag for dates and numbers, e.g. "en-AU", "vi-VN". */
  locale: string;
  search: string;
  clearSearch: string;
  select: string;
  searchEllipsis: string;
  noMatches: string;
  remove: string;
  close: string;
  dismiss: string;
  progress: string;
  mainNav: string;
  remote: string;
  remoteOpenTo: (openTo: string) => string;
  /** Remote eligibility ("who can apply"), see `RemoteAccessBadge`. */
  remoteAccess: {
    worldwide: string;
    only: (places: string) => string;
    unknown: string;
    openToYou: (country: string) => string;
    notOpenToYou: (country: string) => string;
    regions: Record<string, string>;
  };
  read: string;
  viewDetails: string;
  opensInNewTab: string;
  skillsToBrushUp: string;
  via: (source: string) => string;
  today: string;
  daysAgo: (days: number) => string;
  fit: { great: string; good: string; worth: string; long: string };
}

export const EN_UI_STRINGS: UiStrings = {
  locale: "en-AU",
  search: "Search",
  clearSearch: "Clear search",
  select: "Select…",
  searchEllipsis: "Search…",
  noMatches: "No matches",
  remove: "Remove",
  close: "Close",
  dismiss: "Dismiss",
  progress: "Progress",
  mainNav: "Main",
  remote: "Remote",
  remoteOpenTo: (openTo) => `Remote · ${openTo}`,
  remoteAccess: {
    worldwide: "Remote · Worldwide",
    only: (places) => `Remote · ${places} only`,
    unknown: "Remote · region not stated",
    openToYou: (country) => `Open to candidates in ${country}`,
    notOpenToYou: (country) => `Not open to candidates in ${country}`,
    regions: {
      EUROPE: "Europe",
      EMEA: "EMEA",
      APAC: "APAC",
      ASIA: "Asia",
      SEA: "Southeast Asia",
      LATAM: "Latin America",
      NORTH_AMERICA: "North America",
      AMERICAS: "Americas",
      OCEANIA: "Oceania",
      MIDDLE_EAST: "Middle East",
      AFRICA: "Africa",
    },
  },
  read: "Read",
  viewDetails: "View details",
  opensInNewTab: "(opens original posting in a new tab)",
  skillsToBrushUp: "Skills to brush up:",
  via: (source) => `via ${source}`,
  today: "today",
  daysAgo: (days) => (days === 1 ? "1 day ago" : `${days} days ago`),
  fit: { great: "Great fit", good: "Good fit", worth: "Worth a look", long: "Long shot" },
};

const UiStringsContext = createContext<UiStrings>(EN_UI_STRINGS);

export function UiStringsProvider({ value, children }: { value: UiStrings; children: ReactNode }) {
  return <UiStringsContext.Provider value={value}>{children}</UiStringsContext.Provider>;
}

export function useUiStrings(): UiStrings {
  return useContext(UiStringsContext);
}
