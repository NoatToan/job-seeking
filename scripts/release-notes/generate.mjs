#!/usr/bin/env node
// Writes the release-notes entry for the commits pushed to main since the newest entry, using
// Claude (Anthropic Messages API, structured JSON output). Run by .github/workflows/release-notes.yml
// on every push to main; safe to run by hand (`--dry-run` prints the request instead of calling it).
//
//   node scripts/release-notes/generate.mjs [--dry-run]
//
// Env: ANTHROPIC_API_KEY (missing = skip with a notice), RELEASE_NOTES_MODEL (default
// claude-sonnet-5), RELEASE_NOTES_TZ (day boundaries, default Asia/Ho_Chi_Minh), GITHUB_OUTPUT.
//
// One entry per day: commits are grouped by the local date of the newest commit; when the newest
// entry is already that day, Claude rewrites it with the new commits folded in. Every failure is
// soft (a warning, exit 0): the anchor (`commits.to` of the newest entry) only moves when an entry
// is written, so the next push retries the same commits.

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_OUTPUT_SCHEMA, validateAiOutput, validateEntry, validateReleaseNotes } from "./schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NOTES_FILE = "apps/web/src/content/release-notes.json";
export const PROMPT_FILE = path.join(HERE, "prompt.md");
export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
/** In a commit subject (first line), keeps that commit out of the notes; the bot's own commits carry it.
 * Only the subject counts, so a message that merely mentions the marker in its body is not skipped. */
export const SKIP_MARKER = "[skip release-notes]";
const BOT_AUTHORS = new Set(["github-actions[bot]", "release-notes[bot]"]);
/** Most commits sent to the model in one request (the newest ones). */
const MAX_COMMITS = 80;
const MAX_BODY = 1200;
const MAX_FILES = 25;

/** Conventional-commit types that are never user-visible on their own. */
const NOISE_SUBJECT = /^(chore|docs|test|tests|ci|style|build|lint)(\([^)]*\))?!?:/i;
/** Files that never change what a visitor sees. */
const INVISIBLE_FILE =
  /(^docs\/|\.md$|^\.claude\/|^\.github\/|^\.mcp\.json$|(^|\/)tests?\/|(^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|(^|\/)uv\.lock$|^pnpm-lock\.yaml$|^LICENSE)/;

const RS = "\x1e";
const US = "\x1f";

/** `YYYY-MM-DD` of a unix time in a time zone. */
export function localDate(epochSeconds, tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(epochSeconds * 1000));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Parses `git log --format=%x1e%H%x1f%at%x1f%an%x1f%s%x1f%b%x1f --name-only` (oldest first). */
export function parseGitLog(text) {
  return text
    .split(RS)
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [sha, at, author, subject, body, files = ""] = chunk.split(US);
      return {
        sha: sha.trim(),
        time: Number(at),
        author,
        subject,
        body: body.trim(),
        files: files.split("\n").map((f) => f.trim()).filter(Boolean),
      };
    });
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Non-merge commits in `range` (e.g. `abc123..HEAD`), oldest first. */
export function readCommits(range, cwd) {
  return parseGitLog(
    git(["log", "--no-merges", "--reverse", `--format=${RS}%H${US}%at${US}%an${US}%s${US}%b${US}`, "--name-only", range], cwd),
  );
}

/** The workflow's own commits (and anything marked to be left out). */
export function isBotCommit(c) {
  return BOT_AUTHORS.has(c.author) || c.subject.includes(SKIP_MARKER);
}

/** Commits that cannot change what a visitor sees: chore/docs/test/ci… or only docs/tests/tooling files. */
export function isInvisibleCommit(c, notesFile = NOTES_FILE) {
  if (NOISE_SUBJECT.test(c.subject) || /^Merge (pull request|branch|remote-tracking)/.test(c.subject)) return true;
  return c.files.length > 0 && c.files.every((f) => f === notesFile || INVISIBLE_FILE.test(f));
}

/**
 * What to do with the commits since the newest entry. Pure, so the skip rules are testable:
 * `{ action: "skip", reason }` or `{ action: "generate", date, commits, candidates, existing }`
 * where `commits` are every non-bot commit (counted in the entry) and `candidates` the ones worth
 * showing to the model.
 */
export function planRun({ notes, commits, tz = DEFAULT_TZ, notesFile = NOTES_FILE }) {
  const human = commits.filter((c) => !isBotCommit(c));
  if (commits.length === 0) return { action: "skip", reason: "no new commits since the newest entry" };
  if (human.length === 0) return { action: "skip", reason: "only release-notes commits since the newest entry" };
  const candidates = human.filter((c) => !isInvisibleCommit(c, notesFile));
  if (candidates.length === 0) return { action: "skip", reason: "no user-visible commits (chores, docs, tests, CI only)" };
  const date = localDate(human[human.length - 1].time, tz);
  const newest = notes.entries[0];
  const existing = newest && newest.date === date ? newest : null;
  return { action: "generate", date, commits: human, candidates: candidates.slice(-MAX_COMMITS), existing };
}

/** The user turn: the day's commits (and the entry already written that day, if any). */
export function buildUserMessage({ date, candidates, existing }) {
  const lines = [`Date: ${date}`, ""];
  if (existing) {
    lines.push(
      "This day already has an entry. Return the full updated entry (keep what is still true, add the new commits):",
      JSON.stringify({ title: existing.title, highlights: existing.highlights }, null, 2),
      "",
    );
  }
  lines.push(`New commits (${candidates.length}, oldest first):`, "");
  for (const c of candidates) {
    lines.push(`### ${c.subject}`);
    const body = c.body.length > MAX_BODY ? `${c.body.slice(0, MAX_BODY)}…` : c.body;
    if (body) lines.push(body);
    if (c.files.length) {
      const more = c.files.length > MAX_FILES ? ` (+${c.files.length - MAX_FILES} more)` : "";
      lines.push(`Files: ${c.files.slice(0, MAX_FILES).join(", ")}${more}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * One Messages API call with a JSON-schema output format; returns the parsed object.
 * Throws on HTTP errors, refusals, truncation and unparsable output.
 */
export async function callClaude({ apiKey, model = DEFAULT_MODEL, system, user, fetchImpl = fetch }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: AI_OUTPUT_SCHEMA } },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Anthropic API returned ${res.status}: ${detail}`);
  }
  const message = await res.json();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to write the entry (stop_reason: refusal)");
  if (message.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (stop_reason: max_tokens)");
  const text = (message.content ?? []).find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude's answer had no text block");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Claude's answer was not valid JSON");
  }
}

/**
 * Same request through the local Claude Code CLI (`claude -p`, the developer's own login), so the
 * notes can be written on the machine before a push without an API key. Tools off, no session
 * saved, only user settings loaded (no project hooks, so this never recurses into the push hook).
 */
export function callClaudeCli({ model, system, user, spawn = spawnSync }) {
  const res = spawn(
    "claude",
    [
      "-p",
      user,
      "--system-prompt",
      system,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(AI_OUTPUT_SCHEMA),
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "user",
      ...(model ? ["--model", model] : []),
    ],
    { encoding: "utf8", timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
  );
  if (res.error) throw new Error(`claude CLI failed to start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`claude CLI exited ${res.status}: ${(res.stderr || res.stdout || "").slice(0, 300)}`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error("claude CLI output was not JSON");
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const result = messages.find((m) => m && m.type === "result") ?? messages[messages.length - 1];
  if (!result || result.is_error) throw new Error(`claude CLI returned an error: ${String(result?.result ?? "").slice(0, 300)}`);
  if (result.structured_output && typeof result.structured_output === "object") return result.structured_output;
  try {
    return JSON.parse(result.result);
  } catch {
    throw new Error("Claude's answer was not valid JSON");
  }
}

/** The stored entry: model text + date and commit range from git. */
export function makeEntry({ date, out, commits, existing }) {
  const entry = {
    date,
    // A day split by hand into several entries (2026-11-06, 2026-11-06-2) keeps updating its newest.
    slug: existing?.slug ?? date,
    title: { en: out.title.en.trim(), vi: out.title.vi.trim() },
    highlights: out.highlights.map((h) => ({ category: h.category, en: h.en.trim(), vi: h.vi.trim() })),
  };
  if (existing?.screenshot) entry.screenshot = existing.screenshot;
  entry.commits = {
    from: existing?.commits.from ?? commits[0].sha,
    to: commits[commits.length - 1].sha,
    count: (existing?.commits.count ?? 0) + commits.length,
  };
  return entry;
}

/** Newest first; replaces the entry with the same slug (same day) instead of adding a second one. */
export function mergeEntry(notes, entry) {
  const rest = notes.entries.filter((e) => e.slug !== entry.slug);
  return { ...notes, entries: [entry, ...rest] };
}

function setOutput(env, key, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/**
 * The whole run. Returns `{ status: "skipped" | "dry-run" | "written" | "failed", reason?, entry? }`
 * and never throws for expected failures (missing key, API error, invalid output).
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 *   dryRun?: boolean, log?: { log: (message: string) => void } }} [options]
 */
export async function run({
  cwd = process.cwd(),
  env = process.env,
  fetchImpl = fetch,
  dryRun = false,
  local = false,
  spawn = spawnSync,
  log = console,
} = {}) {
  const file = path.join(cwd, NOTES_FILE);
  const notes = JSON.parse(readFileSync(file, "utf8"));
  const fileErrors = validateReleaseNotes(notes);
  if (fileErrors.length) return fail(log, `${NOTES_FILE} is invalid: ${fileErrors.join("; ")}`);

  const anchor = notes.entries[0]?.commits.to;
  let commits;
  try {
    if (anchor) git(["merge-base", "--is-ancestor", anchor, "HEAD"], cwd);
    commits = readCommits(anchor ? `${anchor}..HEAD` : "HEAD", cwd);
  } catch {
    return fail(log, `commit ${anchor} (newest entry) is not in this branch's history; fix commits.to by hand`);
  }

  const tz = env.RELEASE_NOTES_TZ || DEFAULT_TZ;
  const plan = planRun({ notes, commits, tz });
  if (plan.action === "skip") {
    log.log(`Release notes: skipped, ${plan.reason}.`);
    return { status: "skipped", reason: plan.reason };
  }

  const system = readFileSync(PROMPT_FILE, "utf8");
  const user = buildUserMessage(plan);
  const model = env.RELEASE_NOTES_MODEL || DEFAULT_MODEL;
  if (dryRun) {
    log.log(`--- model: ${model}\n--- system:\n${system}\n--- user:\n${user}`);
    return { status: "dry-run" };
  }
  if (!local && !env.ANTHROPIC_API_KEY) {
    log.log("::notice::Release notes: ANTHROPIC_API_KEY is not set, skipping (add the repository secret to turn this on).");
    return { status: "skipped", reason: "no API key" };
  }

  let out;
  try {
    out = local
      ? callClaudeCli({ model: env.RELEASE_NOTES_MODEL || undefined, system, user, spawn })
      : await callClaude({ apiKey: env.ANTHROPIC_API_KEY, model, system, user, fetchImpl });
  } catch (err) {
    return fail(log, err instanceof Error ? err.message : String(err));
  }
  const outErrors = validateAiOutput(out);
  if (outErrors.length) return fail(log, `Claude's entry is invalid: ${outErrors.join("; ")}`);
  if (out.skip) {
    log.log("Release notes: skipped, Claude found nothing user-visible.");
    return { status: "skipped", reason: "nothing user-visible" };
  }

  const entry = makeEntry({ date: plan.date, out, commits: plan.commits, existing: plan.existing });
  const entryErrors = validateEntry(entry);
  if (entryErrors.length) return fail(log, `entry is invalid: ${entryErrors.join("; ")}`);
  const next = mergeEntry(notes, entry);
  const nextErrors = validateReleaseNotes(next);
  if (nextErrors.length) return fail(log, `release notes would be invalid: ${nextErrors.join("; ")}`);

  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  setOutput(env, "changed", "true");
  setOutput(env, "date", entry.date);
  log.log(`Release notes: ${plan.existing ? "updated" : "added"} ${entry.date} (${entry.highlights.length} highlights).`);
  return { status: "written", entry };
}

function fail(log, reason) {
  log.log(`::warning::Release notes not updated: ${reason}`);
  return { status: "failed", reason };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run({ dryRun: process.argv.includes("--dry-run"), local: process.argv.includes("--local") });
}
