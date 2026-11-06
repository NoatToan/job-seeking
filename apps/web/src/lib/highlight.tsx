import type { ReactNode } from "react";
import { techInfo } from "@ujc/core";

/** Words too common to be worth highlighting when they come from a free-text search. */
const STOP_WORDS = new Set(["and", "or", "not", "the", "a", "an", "of", "in", "for", "to", "with", "at", "on"]);

/** Extra spellings postings use for a tech id, beyond its label ("Next.js" -> "NextJS", …). */
const TECH_ALIASES: Record<string, string[]> = {
  nextjs: ["NextJS", "Next"],
  nodejs: ["NodeJS", "Node"],
  react: ["ReactJS", "React.js"],
  vue: ["Vue.js", "VueJS"],
  go: ["Golang"],
  postgresql: ["Postgres"],
  kubernetes: ["K8s"],
  csharp: ["C#"],
  dotnet: [".NET", "ASP.NET"],
  rails: ["Ruby on Rails"],
  gcp: ["GCP"],
};

/**
 * The words to highlight in a job for the current search (Slack request: "in the job detail,
 * highlight the keywords that match the search conditions"): the search box words, the selected
 * techs (label + common spellings) and, in the signed-in feed, the user's own keywords.
 */
export function highlightTerms({
  q,
  tech = [],
  keywords = [],
}: {
  q?: string;
  tech?: readonly string[];
  keywords?: readonly string[];
}): string[] {
  const fromQuery = (q ?? "")
    .replace(/["()]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-+]/, ""))
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
  const fromTech = tech.flatMap((id) => [techInfo(id).label, ...(TECH_ALIASES[id] ?? [])]);
  const all = [...fromQuery, ...fromTech, ...keywords.map((k) => k.trim()).filter(Boolean)];
  // Longest first so "Ruby on Rails" wins over "Ruby"; de-duplicate case-insensitively.
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.length - a.length)
    .filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One case-insensitive regex for all terms, matching whole words only ("Go" not in "Google"). */
export function highlightRegex(terms: readonly string[]): RegExp | null {
  if (!terms.length) return null;
  const body = terms.map(escapeRegExp).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${body})(?![\\p{L}\\p{N}_])`, "giu");
}

/** Which of `terms` appear in `text` (in `terms` order), for a "Matches: …" summary. */
export function matchedTerms(text: string, terms: readonly string[]): string[] {
  return terms.filter((t) => highlightRegex([t])?.test(text));
}

/** `text` with every term wrapped in <mark>. */
export function Highlighted({ text, terms }: { text: string; terms: readonly string[] }): ReactNode {
  const re = highlightRegex(terms);
  if (!re) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <mark key={start} className="rounded-control-sm bg-warning-soft px-0.5 font-medium text-label">
        {m[0]}
      </mark>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
