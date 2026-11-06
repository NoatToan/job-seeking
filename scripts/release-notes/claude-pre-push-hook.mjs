#!/usr/bin/env node
// Claude Code PreToolUse hook (registered in .claude/settings.json): before Claude runs a
// `git push` from main, write today's release-notes entry with the local Claude CLI and commit it,
// so it goes out in the same push. No API key needed (it uses the developer's own login).
// Never blocks the push: any failure is printed and the push goes ahead without new notes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { NOTES_FILE, SKIP_MARKER, run } from "./generate.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const command = String(input?.tool_input?.command ?? "");
const push = command.match(/\bgit\s+push\b(.*)$/s);
if (!push) process.exit(0);

try {
  // Only pushes from main that publish main (plain `git push`, `git push origin`, `... main`,
  // `... HEAD:main`); a push of another branch or a tag is left alone.
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const refs = push[1].split(/\s+/).filter((a) => a && !a.startsWith("-")).slice(1);
  const publishesMain = refs.length === 0 || refs.some((r) => /^(HEAD:)?(refs\/heads\/)?main$/.test(r));
  if (branch !== "main" || !publishesMain) process.exit(0);
  if (git("status", "--porcelain", "--", NOTES_FILE)) {
    console.error(`release notes: ${NOTES_FILE} has local edits, not touching it.`);
    process.exit(0);
  }
  const log = { log: (m) => console.error(m), error: (m) => console.error(m) };
  const result = await run({ local: true, log });
  if (result?.status !== "written") process.exit(0);
  git("add", NOTES_FILE);
  git("commit", "-q", "-m", `Release notes: ${result.entry.date} ${SKIP_MARKER}`, "--", NOTES_FILE);
  console.error(`release notes: committed the ${result.entry.date} entry; it goes out with this push.`);
} catch (err) {
  console.error(`release notes hook: ${err instanceof Error ? err.message : String(err)} (push continues)`);
}
process.exit(0);
