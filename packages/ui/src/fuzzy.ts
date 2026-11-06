/**
 * Client-side fuzzy matcher for pickers whose whole option list is already in the browser
 * (countries, time zones, sources, tech…): no backend round trip, no dependency.
 *
 * Text and query are compared folded: lower case, accents stripped (Vietnamese included:
 * "việt" = "viet", "đ" = "d") and separators (`_ / - . , ( )`) read as spaces, so
 * "ho chi minh" finds "Asia/Ho_Chi_Minh" and "hồ chí minh" finds it too.
 *
 * Ranking is by tier first, then by a small bonus inside the tier (earlier, shorter, consecutive):
 *
 *   exact  >  prefix  >  word-start  >  acronym  >  substring  >  all words (any order)  >  subsequence
 *
 * "acronym" = every query letter starts a word, in order ("ny" -> New York, "hcm" -> Ho Chi
 * Minh); it sits above a plain substring so "ny" prefers New York over "Sydney".
 */

const MARKS = /[̀-ͯ]/g;
const SEPARATORS = /[\s_/\-.,()]/;

/** Folded form of `text` (lower case, no accents, "đ" -> "d"). Separators are kept as-is. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(MARKS, "").replace(/đ/g, "d");
}

/** Folded text with every separator turned into a space, plus where each folded char came from. */
interface Folded {
  text: string;
  /** `source[i]` = UTF-16 index in the original string of folded char `i`. */
  source: number[];
}

function fold(text: string): Folded {
  let out = "";
  const source: number[] = [];
  let index = 0;
  for (const char of text) {
    const folded = SEPARATORS.test(char) ? " " : normalize(char);
    out += folded;
    // One entry per UTF-16 unit, so indices into `out` line up with `source`.
    for (let k = 0; k < folded.length; k++) source.push(index);
    index += char.length;
  }
  return { text: out, source };
}

function foldQuery(query: string): string {
  return fold(query).text.replace(/\s+/g, " ").trim();
}

export const TIER = {
  exact: 7,
  prefix: 6,
  wordStart: 5,
  acronym: 4,
  substring: 3,
  words: 2,
  subsequence: 1,
} as const;

export interface FuzzyMatch {
  /** Higher is better. `Math.floor(score / 1000)` is the `TIER`. */
  score: number;
  /** Matched characters, as UTF-16 indices into the original text (for highlighting). */
  indices: number[];
}

const isWordStart = (t: string, i: number) => i === 0 || t[i - 1] === " ";

function range(f: Folded, from: number, length: number): number[] {
  const out: number[] = [];
  for (let i = from; i < from + length; i++) out.push(f.source[i]);
  return out;
}

function uniqueSorted(indices: number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

/** First occurrence of `q` in `t` that starts a word, or -1. */
function wordStartIndex(t: string, q: string): number {
  let i = t.indexOf(q);
  while (i !== -1) {
    if (isWordStart(t, i)) return i;
    i = t.indexOf(q, i + 1);
  }
  return -1;
}

/** Positions of `q`'s letters, each at a word start and in order; null when impossible. */
function acronym(t: string, q: string): number[] | null {
  if (q.length < 2 || q.includes(" ")) return null;
  const out: number[] = [];
  let from = 0;
  for (const ch of q) {
    let found = -1;
    for (let i = from; i < t.length; i++) {
      if (t[i] === ch && isWordStart(t, i)) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    out.push(found);
    from = found + 1;
  }
  return out;
}

/** Greedy in-order positions of every query letter (spaces ignored), with a quality bonus. */
function subsequence(t: string, q: string): { at: number[]; bonus: number } | null {
  const at: number[] = [];
  let from = 0;
  let bonus = 0;
  let run = 0;
  for (const ch of q.replace(/ /g, "")) {
    const found = t.indexOf(ch, from);
    if (found === -1) return null;
    const gap = found - from;
    run = gap === 0 && at.length ? run + 1 : 0;
    bonus += 10 + run * 5 + (isWordStart(t, found) ? 15 : 0) - Math.min(gap, 10);
    at.push(found);
    from = found + 1;
  }
  return { at, bonus };
}

/** Within-tier bonus (0..999): earlier and shorter texts win. */
function bonus(position: number, textLength: number, queryLength: number): number {
  return Math.max(0, 999 - position * 10 - (textLength - queryLength));
}

/** How well `query` matches `text`, or null when it doesn't. An empty query matches everything. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = foldQuery(query);
  if (!q) return { score: 0, indices: [] };
  const f = fold(text);
  const t = f.text;
  const score = (tier: number, extra: number) => tier * 1000 + Math.min(999, Math.max(0, extra));

  if (t.trim() === q) return { score: score(TIER.exact, 999), indices: range(f, t.indexOf(q), q.length) };
  if (t.startsWith(q)) return { score: score(TIER.prefix, bonus(0, t.length, q.length)), indices: range(f, 0, q.length) };
  const word = wordStartIndex(t, q);
  if (word !== -1) return { score: score(TIER.wordStart, bonus(word, t.length, q.length)), indices: range(f, word, q.length) };
  const letters = acronym(t, q);
  if (letters) {
    return { score: score(TIER.acronym, bonus(letters[0], t.length, q.length)), indices: letters.map((i) => f.source[i]) };
  }
  const sub = t.indexOf(q);
  if (sub !== -1) return { score: score(TIER.substring, bonus(sub, t.length, q.length)), indices: range(f, sub, q.length) };

  // Several words in any order ("minh ho"): each must appear, word starts count more.
  const tokens = q.split(" ");
  if (tokens.length > 1) {
    const hits: number[] = [];
    let extra = 999 - (t.length - q.length);
    let all = true;
    for (const token of tokens) {
      const at = wordStartIndex(t, token);
      const pos = at !== -1 ? at : t.indexOf(token);
      if (pos === -1) {
        all = false;
        break;
      }
      if (at === -1) extra -= 100;
      hits.push(...range(f, pos, token.length));
    }
    if (all) return { score: score(TIER.words, extra), indices: uniqueSorted(hits) };
  }

  const seq = subsequence(t, q);
  if (!seq) return null;
  return { score: score(TIER.subsequence, seq.bonus * 4 - (t.length - seq.at.length)), indices: seq.at.map((i) => f.source[i]) };
}

/** Score of `query` against `text` (higher is better), or null when it doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyMatch(query, text)?.score ?? null;
}

/** A ranked item. `indices` point into the item's first text (its label) when that is what matched. */
export interface FuzzyResult<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Matches on an alias / keyword rank just under the same kind of match on the label. */
const KEYWORD_PENALTY = 50;

/**
 * `items` that match `query`, best first (stable for ties). `text` returns the label, or
 * `[label, ...keywords]`: keywords (codes, aliases, other-language names) are searched too but
 * only the label is highlighted. Empty query = everything, in the original order.
 */
export function fuzzyRank<T>(items: readonly T[], query: string, text: (item: T) => string | readonly string[]): FuzzyResult<T>[] {
  if (!foldQuery(query)) return items.map((item) => ({ item, score: 0, indices: [] }));
  const out: (FuzzyResult<T> & { index: number })[] = [];
  items.forEach((item, index) => {
    const texts = text(item);
    const [label, ...keywords] = typeof texts === "string" ? [texts] : texts;
    let best: FuzzyResult<T> | null = null;
    const onLabel = label ? fuzzyMatch(query, label) : null;
    if (onLabel) best = { item, score: onLabel.score, indices: onLabel.indices };
    for (const k of keywords) {
      if (!k) continue;
      const m = fuzzyMatch(query, k);
      if (m && (!best || m.score - KEYWORD_PENALTY > best.score)) best = { item, score: m.score - KEYWORD_PENALTY, indices: [] };
    }
    if (best) out.push({ ...best, index });
  });
  out.sort((a, b) => b.score - a.score || a.index - b.index);
  return out.map(({ item, score, indices }) => ({ item, score, indices }));
}

/** `items` that match `query`, best first (stable for ties). Empty query = everything, in order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string | readonly string[]): T[] {
  return fuzzyRank(items, query, text).map((r) => r.item);
}
