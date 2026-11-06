"use client";

import { useCallback, useSyncExternalStore } from "react";
import { countryForZone } from "@ujc/core";
import { updatePreferences } from "./api";
import { useSession } from "./session";
import { useUserTimezone } from "./user-timezone";

const STORAGE_KEY = "ujc:based-in";
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writeStored(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(STORAGE_KEY, code);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled: the choice just won't survive a reload.
  }
  listeners.forEach((l) => l());
}

export interface BasedIn {
  /** ISO country the candidate lives in, or null when unknown. */
  country: string | null;
  /** True when `country` is only a guess from the time zone (nothing saved yet). */
  guessed: boolean;
  setCountry: (code: string | null) => Promise<void>;
}

/**
 * Where the candidate lives, to tell them which remote jobs accept them. Signed in: the saved
 * "I'm based in" preference (`preferences.candidateCountry`, also used by the feed's eligibility
 * filter). Signed out: what they picked in this browser. Otherwise a guess from their time zone
 * (Asia/Ho_Chi_Minh → VN).
 */
export function useBasedIn(): BasedIn {
  const { me, refresh } = useSession();
  const { zone } = useUserTimezone();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const saved = me?.preferences.candidateCountry ?? stored;
  const country = saved ?? countryForZone(zone);

  const setCountry = useCallback(
    async (code: string | null) => {
      writeStored(code);
      if (me) {
        await updatePreferences({ ...me.preferences, candidateCountry: code });
        await refresh();
      }
    },
    [me, refresh],
  );

  return { country, guessed: !saved && Boolean(country), setCountry };
}
