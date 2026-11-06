/**
 * Small client-side fuzzy matcher for pickers whose whole option list is already in the browser
 * (countries, time zones, sources…): no backend round trip, no dependency.
 *
 * Every query character must appear in order (a subsequence). The score rewards prefix matches,
 * matches at word starts ("ny" -> "New York") and consecutive runs, and penalises gaps, so the
 * best candidates float to the top. Accents are ignored ("ho chi minh" finds "Hồ Chí Minh").
 */

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const WORD_BREAK = /[\s/_\-().,]/;

/** Score of `query` against `text` (higher is better), or null when it doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query).replace(/\s+/g, " ").trim();
  if (!q) return 0;
  const t = normalize(text);
  const direct = t.indexOf(q);
  if (direct !== -1) {
    // Whole query found as-is: best case, earlier and at a word start is better still.
    const atWord = direct === 0 || WORD_BREAK.test(t[direct - 1]);
    return 1000 - direct + (atWord ? 200 : 0) - (t.length - q.length) * 0.1;
  }
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q.replace(/ /g, "")) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    const gap = found - ti;
    run = gap === 0 && ti > 0 ? run + 1 : 0;
    const atWord = found === 0 || WORD_BREAK.test(t[found - 1]);
    score += 10 + run * 5 + (atWord ? 15 : 0) - Math.min(gap, 10);
    ti = found + 1;
  }
  return score - (t.length - ti) * 0.05;
}

/** `items` that match `query`, best first (stable for ties). Empty query = everything, in order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
