"use client";

import { useCallback, useSyncExternalStore } from "react";
import { updatePreferences } from "./api";
import { useSession } from "./session";
import { browserTimezone, canonicalZone } from "./work-hours";

const STORAGE_KEY = "ujc:timezone";
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Prerender (no browser): a fixed zone, the same on every build machine. */
function serverTimezone(): string {
  return "UTC";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writeStored(zone: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, zone);
  } catch {
    // Private mode / storage disabled: the choice just won't survive a reload.
  }
  listeners.forEach((l) => l());
}

export interface UserTimezone {
  zone: string;
  /** Saves the choice: in this browser always, and in the account's preferences when signed in
   * (`user_preferences.digest_tz`, also used for the daily digest's send time). */
  setZone: (zone: string) => Promise<void>;
}

/**
 * The user's own time zone, used to show each job's working hours on their clock.
 * Signed in: the saved preference (`preferences.digestTz`). Signed out: what they picked in
 * this browser, else the browser's own zone.
 */
export function useUserTimezone(): UserTimezone {
  const { me, refresh } = useSession();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  // The browser's zone through the same store, so a page prerendered at build time (on a UTC
  // machine) hydrates with the build's value and then switches, instead of a hydration mismatch.
  const browser = useSyncExternalStore(subscribe, browserTimezone, serverTimezone);
  const zone = me?.preferences.digestTz ?? stored ?? browser;

  const setZone = useCallback(
    async (next: string) => {
      writeStored(next);
      if (me) {
        await updatePreferences({ ...me.preferences, digestTz: next });
        await refresh();
      }
    },
    [me, refresh],
  );

  return { zone, setZone };
}

/** Every IANA zone this browser knows (≈400), or a short fallback list on old engines. */
export function timezoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  if (!zones.length) {
    zones = [
      "Asia/Ho_Chi_Minh",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Asia/Kolkata",
      "Australia/Sydney",
      "Europe/London",
      "Europe/Berlin",
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
      "UTC",
    ];
  }
  // Show current names only (Intl lists some legacy aliases such as Asia/Saigon too).
  zones = [...new Set(zones.map(canonicalZone))].sort();
  return zones.includes(current) ? zones : [current, ...zones];
}
