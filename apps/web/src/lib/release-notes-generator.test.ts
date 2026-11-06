// scripts/release-notes/generate.mjs (run by .github/workflows/release-notes.yml): skip rules,
// the Messages API request, and whole runs against a throwaway git repo with a mocked API.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUserMessage,
  callClaude,
  isBotCommit,
  isInvisibleCommit,
  localDate,
  NOTES_FILE,
  planRun,
  run,
  SKIP_MARKER,
} from "../../../../scripts/release-notes/generate.mjs";

type Commit = { sha: string; time: number; author: string; subject: string; body: string; files: string[] };

const commit = (subject: string, files: string[] = ["apps/web/src/app/page.tsx"], extra: Partial<Commit> = {}): Commit => ({
  sha: "a".repeat(40),
  time: Date.UTC(2026, 10, 7, 3) / 1000,
  author: "Tony",
  subject,
  body: "",
  files,
  ...extra,
});

const AI_ENTRY = {
  skip: false,
  title: { en: "Release notes page", vi: "Trang ghi chú phát hành" },
  highlights: [{ category: "new", en: "See what changed, day by day", vi: "Xem thay đổi theo từng ngày" }],
};

function apiResponse(output: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: JSON.stringify(output) },
      ],
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const silent = { log: vi.fn() };

describe("skip rules", () => {
  it("drops the bot's own commits and anything marked [skip release-notes]", () => {
    expect(isBotCommit(commit("Release notes for 2026-11-07 [skip release-notes]"))).toBe(true);
    expect(isBotCommit(commit("Tweak", undefined, { author: "github-actions[bot]" }))).toBe(true);
    expect(isBotCommit(commit(`Fix typo ${SKIP_MARKER}`))).toBe(true);
    // A body that only mentions the marker (e.g. docs about it) does not count.
    expect(isBotCommit(commit("Release notes page", undefined, { body: `Bot commits carry ${SKIP_MARKER}.` }))).toBe(false);
    expect(isBotCommit(commit("Fix login"))).toBe(false);
  });

  it("treats chores, docs, tests, CI and merges as invisible", () => {
    expect(isInvisibleCommit(commit("chore(deploy): bump"))).toBe(true);
    expect(isInvisibleCommit(commit("docs: product spec"))).toBe(true);
    expect(isInvisibleCommit(commit("Merge pull request #9 from x/y"))).toBe(true);
    expect(isInvisibleCommit(commit("Explain things", ["docs/DECISIONS.md", "README.md"]))).toBe(true);
    expect(isInvisibleCommit(commit("Stabilise", ["apps/web/src/app/feed.test.tsx", ".github/workflows/ci.yml"]))).toBe(true);
    expect(isInvisibleCommit(commit("Dark mode", ["apps/web/src/lib/theme.tsx", "docs/DECISIONS.md"]))).toBe(false);
  });

  const notes = { version: 1, entries: [] as { date: string }[] };

  it("skips with nothing new, only bot commits or only invisible commits", () => {
    expect(planRun({ notes, commits: [] })).toMatchObject({ action: "skip", reason: expect.stringMatching(/no new commits/) });
    expect(planRun({ notes, commits: [commit(`Release notes ${SKIP_MARKER}`)] })).toMatchObject({
      action: "skip",
      reason: expect.stringMatching(/only release-notes/),
    });
    expect(planRun({ notes, commits: [commit("ci: cache pnpm"), commit("Docs", ["README.md"])] })).toMatchObject({
      action: "skip",
      reason: expect.stringMatching(/no user-visible/),
    });
  });

  it("dates the entry by the newest commit in the configured time zone and folds into the same day", () => {
    // 2026-11-06 20:00 UTC is already 2026-11-07 in Vietnam.
    const late = commit("Dark mode", undefined, { time: Date.UTC(2026, 10, 6, 20) / 1000 });
    expect(localDate(late.time, "Asia/Ho_Chi_Minh")).toBe("2026-11-07");
    expect(localDate(late.time, "UTC")).toBe("2026-11-06");
    const sameDay = { version: 1, entries: [{ date: "2026-11-07" }] };
    const plan = planRun({ notes: sameDay, commits: [commit("chore: x"), late] });
    expect(plan).toMatchObject({ action: "generate", date: "2026-11-07", existing: { date: "2026-11-07" } });
    if (plan.action === "generate") {
      expect(plan.commits).toHaveLength(2); // counted
      expect(plan.candidates.map((c: Commit) => c.subject)).toEqual(["Dark mode"]); // shown to the model
    }
  });

  it("sends the day's earlier entry with the new commits", () => {
    const text = buildUserMessage({
      date: "2026-11-07",
      candidates: [commit("Dark mode", ["a.tsx"], { body: "System, Light, Dark." })],
      existing: { title: { en: "Earlier", vi: "Trước" }, highlights: [] },
    });
    expect(text).toContain("Date: 2026-11-07");
    expect(text).toContain("already has an entry");
    expect(text).toContain('"en": "Earlier"');
    expect(text).toContain("### Dark mode\nSystem, Light, Dark.\nFiles: a.tsx");
  });
});

describe("callClaude", () => {
  it("posts one Messages API request with the JSON-schema output format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(apiResponse(AI_ENTRY));
    const out = await callClaude({ apiKey: "sk-test", system: "SYSTEM", user: "USER", fetchImpl });
    expect(out).toEqual(AI_ENTRY);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("SYSTEM");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toEqual(["skip", "title", "highlights"]);
  });

  it("throws on HTTP errors, refusals and truncated answers", async () => {
    const call = (res: Response) => callClaude({ apiKey: "k", system: "", user: "", fetchImpl: vi.fn().mockResolvedValue(res) });
    await expect(call(new Response("overloaded", { status: 529 }))).rejects.toThrow(/529/);
    await expect(call(apiResponse(AI_ENTRY, { stop_reason: "refusal" }))).rejects.toThrow(/refusal/);
    await expect(call(apiResponse(AI_ENTRY, { stop_reason: "max_tokens" }))).rejects.toThrow(/cut off/);
  });
});

describe("run (temp git repo)", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const notesPath = () => path.join(repo, NOTES_FILE);
  const readNotes = () => JSON.parse(readFileSync(notesPath(), "utf8"));
  const commitFile = (file: string, subject: string, date = "2026-11-07T10:00:00+07:00") => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), `${subject}\n`);
    git("add", "-A");
    execFileSync("git", ["commit", "-q", "-m", subject], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git("rev-parse", "HEAD");
  };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "release-notes-"));
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Tony");
    git("config", "user.email", "tony@example.test");
    git("config", "commit.gpgsign", "false");
    const first = commitFile("apps/web/src/app/page.tsx", "Home page", "2026-11-06T10:00:00+07:00");
    mkdirSync(path.dirname(notesPath()), { recursive: true });
    writeFileSync(
      notesPath(),
      `${JSON.stringify(
        {
          version: 1,
          entries: [
            {
              date: "2026-11-06",
              slug: "2026-11-06",
              title: { en: "Home page", vi: "Trang chủ" },
              highlights: [{ category: "new", en: "A home page", vi: "Trang chủ" }],
              commits: { from: first, to: first, count: 1 },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    git("add", "-A");
    git("commit", "-q", "-m", `Release notes for 2026-11-06 ${SKIP_MARKER}`);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("writes a new day's entry from the commits since the anchor", async () => {
    commitFile("apps/web/src/app/release-notes/page.tsx", "Release notes page");
    const head = commitFile("docs/DECISIONS.md", "docs: decision");
    const fetchImpl = vi.fn().mockResolvedValue(apiResponse(AI_ENTRY));
    const output = path.join(repo, "gh-output");
    const result = await run({ cwd: repo, env: { ANTHROPIC_API_KEY: "k", GITHUB_OUTPUT: output }, fetchImpl, log: silent });
    expect(result.status).toBe("written");
    const notes = readNotes();
    expect(notes.entries.map((e: { slug: string }) => e.slug)).toEqual(["2026-11-07", "2026-11-06"]);
    expect(notes.entries[0]).toMatchObject({ title: AI_ENTRY.title, commits: { to: head, count: 2 } });
    // The docs-only commit is counted but not sent; the bot's notes commit is neither.
    const user = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content as string;
    expect(user).toContain("### Release notes page");
    expect(user).not.toContain("docs: decision");
    expect(user).not.toContain(SKIP_MARKER);
    expect(readFileSync(output, "utf8")).toBe("changed=true\ndate=2026-11-07\n");
  });

  it("does not run again for its own commit (no loop)", async () => {
    // After the setup, HEAD is the bot's notes commit on top of the anchor.
    const fetchImpl = vi.fn();
    const result = await run({ cwd: repo, env: { ANTHROPIC_API_KEY: "k" }, fetchImpl, log: silent });
    expect(result).toMatchObject({ status: "skipped", reason: expect.stringMatching(/only release-notes/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rewrites the same day's entry instead of adding a second one", async () => {
    const head = commitFile("apps/web/src/app/nav.tsx", "Nav link", "2026-11-06T18:00:00+07:00");
    const fetchImpl = vi.fn().mockResolvedValue(apiResponse(AI_ENTRY));
    await run({ cwd: repo, env: { ANTHROPIC_API_KEY: "k" }, fetchImpl, log: silent });
    const notes = readNotes();
    expect(notes.entries).toHaveLength(1);
    expect(notes.entries[0]).toMatchObject({ slug: "2026-11-06", title: AI_ENTRY.title, commits: { to: head, count: 2 } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content).toContain("already has an entry");
  });

  it("fails soft: no key, an API error, invalid output or a model skip leave the file alone", async () => {
    commitFile("apps/web/src/app/page.tsx", "Bigger search box");
    const before = readFileSync(notesPath(), "utf8");
    const log = { log: vi.fn() };

    expect(await run({ cwd: repo, env: {}, fetchImpl: vi.fn(), log })).toMatchObject({ status: "skipped", reason: "no API key" });
    expect(log.log).toHaveBeenCalledWith(expect.stringMatching(/^::notice::.*ANTHROPIC_API_KEY/));

    const env = { ANTHROPIC_API_KEY: "k" };
    const down = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    expect(await run({ cwd: repo, env, fetchImpl: down, log })).toMatchObject({ status: "failed" });
    expect(log.log).toHaveBeenCalledWith(expect.stringMatching(/^::warning::.*500/));

    const badOutput = { ...AI_ENTRY, highlights: [{ category: "misc", en: "x", vi: "y" }] };
    expect(await run({ cwd: repo, env, fetchImpl: vi.fn().mockResolvedValue(apiResponse(badOutput)), log })).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/category/),
    });

    const skip = { skip: true, title: { en: "", vi: "" }, highlights: [] };
    expect(await run({ cwd: repo, env, fetchImpl: vi.fn().mockResolvedValue(apiResponse(skip)), log })).toMatchObject({
      status: "skipped",
      reason: "nothing user-visible",
    });

    expect(readFileSync(notesPath(), "utf8")).toBe(before);
  });
});
