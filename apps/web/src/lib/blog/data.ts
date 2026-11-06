import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMPTY_SNAPSHOT, parseSnapshot } from "./model";
import type { BlogSnapshot } from "./types";

/**
 * Build-time only: reads the snapshot `scripts/export-blog.mjs` wrote (apps/web/.blog/snapshot.json,
 * or BLOG_SNAPSHOT_PATH). Imported by server components and static route handlers, which run in
 * Node during `next build`; no browser bundle includes it. A missing file means "no posts yet".
 */
let cached: BlogSnapshot | null = null;

export function snapshotPath(): string {
  return process.env.BLOG_SNAPSHOT_PATH || path.join(process.cwd(), ".blog", "snapshot.json");
}

export function loadSnapshot(): BlogSnapshot {
  if (cached) return cached;
  const file = snapshotPath();
  cached = existsSync(file) ? parseSnapshot(JSON.parse(readFileSync(file, "utf8"))) : EMPTY_SNAPSHOT;
  return cached;
}
