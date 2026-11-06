"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { clearViewedJobs, getViewedJobs, markJobsViewed } from "./api";

/**
 * "Which jobs have I already read" (Slack request — "note what the user has already read, save it
 * per session; once they log in, sync it"). Kept in this browser (localStorage) so it survives a
 * reload even signed out; when signed in, merged with the account's history
 * (`GET/POST /api/me/viewed`) so it follows the user to other devices.
 */
const STORAGE_KEY = "ujc:viewed";
/** Cap the local list (oldest dropped) so localStorage never grows without bound. */
const MAX_LOCAL = 3000;
/** Server POST accepts at most this many ids at once. */
const POST_BATCH = 500;

let ids: string[] | null = null; // newest last
let snapshot: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
/** Ids viewed while signed in that still have to reach the server. */
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let signedIn = false;

function load(): string[] {
  if (ids) return ids;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    ids = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    ids = [];
  }
  snapshot = new Set(ids);
  return ids;
}

function save(next: string[]): void {
  ids = next.slice(-MAX_LOCAL);
  snapshot = new Set(ids);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage full / disabled: keep the in-memory copy for this tab.
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): ReadonlySet<string> {
  load();
  return snapshot;
}

const EMPTY: ReadonlySet<string> = new Set();

function scheduleFlush(): void {
  if (!signedIn || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 1500);
}

async function flush(): Promise<void> {
  if (!signedIn || !pending.size) return;
  const batch = [...pending].slice(0, POST_BATCH);
  try {
    await markJobsViewed(batch);
    batch.forEach((id) => pending.delete(id));
  } catch {
    // Offline / server error: keep them pending, the next view or sign-in retries.
    return;
  }
  if (pending.size) scheduleFlush();
}

/** Marks a job as read (no-op if it already is, apart from moving it to "most recent"). */
export function markViewed(id: string): void {
  const current = load();
  if (current[current.length - 1] !== id) save([...current.filter((v) => v !== id), id]);
  if (signedIn) {
    pending.add(id);
    scheduleFlush();
  }
}

/** Signed in: pull the account's history into this browser and push what was read here. */
export async function syncViewed(): Promise<void> {
  const local = load();
  const remote = (await getViewedJobs()).jobIds; // newest first
  const remoteSet = new Set(remote);
  pending = new Set([...pending, ...local.filter((id) => !remoteSet.has(id))]);
  save([...[...remote].reverse().filter((id) => !local.includes(id)), ...local]);
  await flush();
}

/** Forget everything read (here, and on the account when signed in). */
export async function clearViewed(): Promise<void> {
  pending = new Set();
  save([]);
  if (signedIn) await clearViewedJobs();
}

export function useViewedJobs(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** Called by `ViewedSync` (app/viewed-sync.tsx) when the session changes: signed in = sync. */
export function setViewedSignedIn(on: boolean): void {
  signedIn = on;
}

/** Test hook: drop the module state between tests. */
export function resetViewedForTests(): void {
  ids = null;
  snapshot = new Set();
  pending = new Set();
  signedIn = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

/** Dwell time before a job shown in the detail panel counts as read (scroll-spy passes many). */
export const VIEW_DWELL_MS = 2000;

/** Marks `id` as read once it has stayed on screen for `VIEW_DWELL_MS`. */
export function useMarkViewedAfterDwell(id: string | null | undefined, delayMs = VIEW_DWELL_MS): void {
  const mark = useCallback(() => {
    if (id) markViewed(id);
  }, [id]);
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(mark, delayMs);
    return () => clearTimeout(timer);
  }, [id, delayMs, mark]);
}
