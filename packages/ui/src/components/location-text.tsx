import { Fragment } from "react";
import type { ReactNode } from "react";

/** "VN" -> "🇻🇳" (regional-indicator pair). */
export function flagEmoji(code: string): string {
  const cc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...Array.from(cc).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Common ways boards write a country that Intl's English names don't cover. */
const ALIASES: Record<string, string> = {
  USA: "US",
  "U.S.": "US",
  "U.S.A.": "US",
  "United States of America": "US",
  America: "US",
  UK: "GB",
  "U.K.": "GB",
  "Great Britain": "GB",
  England: "GB",
  Scotland: "GB",
  Wales: "GB",
  UAE: "AE",
  "Viet Nam": "VN",
  "South Korea": "KR",
  Korea: "KR",
  Czechia: "CZ",
  "Czech Republic": "CZ",
  Holland: "NL",
  Türkiye: "TR",
  Turkey: "TR",
  Deutschland: "DE",
  "Hong Kong": "HK",
};

/** Uppercase-only codes boards put in locations ("Remote - US", "Austin, TX, US"). Matched
 * case-sensitively so "us" / "in" in prose never get a flag. */
const CODE_ALIASES = ["US", "UK", "CA", "AU", "NZ", "DE", "FR", "NL", "SG", "VN", "IN", "BR", "MX", "ES", "PT", "PL"];

interface Matcher {
  names: RegExp;
  codes: RegExp;
  byName: Map<string, string>;
}

let matcher: Matcher | null = null;

/** Not countries ("EU", "UN", pseudo-regions), or names that clash with US places ("Jersey" in
 * "New Jersey"). */
const SKIP = ["EU", "EZ", "UN", "ZZ", "QO", "XA", "XB", "JE"];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(): Matcher {
  const byName = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        const name = names.of(code);
        // Unknown codes come back unchanged; skip those and the non-country "EU"/"UN"/"ZZ".
        if (name && name !== code && !SKIP.includes(code)) {
          byName.set(name.toLowerCase(), code);
        }
      }
    }
  } catch {
    // No Intl.DisplayNames: aliases only.
  }
  for (const [alias, code] of Object.entries(ALIASES)) byName.set(alias.toLowerCase(), code);
  const keys = [...byName.keys()].sort((x, y) => y.length - x.length).map(escape);
  return {
    // Whole words only ("Indiana" is not India, "Oman" not inside "Romania").
    names: new RegExp(`(?<![\\p{L}])(${keys.join("|")})(?![\\p{L}])`, "giu"),
    codes: new RegExp(`(?<![\\p{L}])(${CODE_ALIASES.join("|")})(?![\\p{L}])`, "gu"),
    byName,
  };
}

/** Countries mentioned in a location, in order: [{ start, end, code }]. */
export function findCountries(text: string): { start: number; end: number; code: string }[] {
  matcher ??= buildMatcher();
  const found: { start: number; end: number; code: string }[] = [];
  for (const m of text.matchAll(matcher.names)) {
    const code = matcher.byName.get(m[0].toLowerCase());
    if (code) found.push({ start: m.index, end: m.index + m[0].length, code });
  }
  for (const m of text.matchAll(matcher.codes)) {
    const start = m.index;
    if (found.some((f) => start < f.end && start + m[0].length > f.start)) continue;
    found.push({ start, end: start + m[0].length, code: m[0] === "UK" ? "GB" : m[0] });
  }
  return found.sort((x, y) => x.start - y.start);
}

/**
 * A job location with a flag before every country it names (Slack request: "put the country
 * flag before country names so I can recognise them without reading"): "Remote, 🇺🇸 United
 * States", "🇩🇪 Germany / 🇳🇱 Netherlands". The flag is decorative (`aria-hidden`); the name stays.
 */
export function LocationText({ text }: { text: string }) {
  const hits = findCountries(text);
  if (!hits.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) parts.push(text.slice(at, h.start));
    parts.push(
      <Fragment key={h.start}>
        <span aria-hidden className="mr-1">
          {flagEmoji(h.code)}
        </span>
        {text.slice(h.start, h.end)}
      </Fragment>,
    );
    at = h.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
