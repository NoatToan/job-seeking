import {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs";

/**
 * Query-string state shared by the pages (Slack request: "use nuqs for every query on the page").
 * The URL is the source of truth, so a filtered list, a live search or a job can be shared,
 * bookmarked and restored by Back. Updates replace the current history entry (nuqs' default), so
 * typing in a filter never stacks up Back steps; values equal to their default are dropped from
 * the URL (`clearOnDefault`, also the default).
 */

/** "Posted within" values: "1h" = past hour, "today" = since local midnight, else days; "" = any time. */
export const POSTED_DAYS = ["1h", "today", "3", "7", "30"] as const;

/** `posted` → the API's `hours` / `days` params. "today" counts hours since the visitor's midnight. */
export function postedParams(posted: string | null, now: Date = new Date()): { days?: number; hours?: number } {
  if (!posted) return {};
  if (posted === "1h") return { hours: 1 };
  if (posted === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return { hours: Math.max(1, Math.ceil((now.getTime() - midnight.getTime()) / 3_600_000)) };
  }
  return { days: Number(posted) };
}

/** "Remote region": open = hide remote jobs that don't accept my country (keep "not stated");
 * confirmed = only remote jobs whose stated region includes my country. */
export const REMOTE_ACCESS = ["open", "confirmed"] as const;

/** "9-17" ⇄ [9, 17]: whole hours on the user's clock, 0 ≤ from < to ≤ 24. */
export const parseAsHourRange = createParser<[number, number]>({
  parse: (v) => {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(v);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2]);
    return from >= 0 && to <= 24 && from < to ? [from, to] : null;
  },
  serialize: ([from, to]) => `${from}-${to}`,
  eq: (a, b) => a[0] === b[0] && a[1] === b[1],
});

/** Home-page job filters (public catalogue and the signed-in feed use the same keys). */
export const jobFilterParsers = {
  q: parseAsString.withDefault(""),
  source: parseAsString.withDefault(""),
  remote: parseAsBoolean.withDefault(false),
  country: parseAsString.withDefault(""),
  tech: parseAsArrayOf(parseAsString).withDefault([]),
  posted: parseAsStringLiteral(POSTED_DAYS),
  access: parseAsStringLiteral(REMOTE_ACCESS),
  hours: parseAsHourRange,
};

/** `/` "All jobs | For you" when signed in. */
export const homeModeParser = parseAsStringLiteral(["all", "matches"] as const);

/** `/search/`: live search query (unset = the user's first keyword) and the platforms switched off. */
export const liveSearchParsers = {
  q: parseAsString,
  off: parseAsArrayOf(parseAsString).withDefault([]),
};
