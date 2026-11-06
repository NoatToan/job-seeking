/**
 * Who may apply to a remote job, in a shape the UI can state plainly ("Worldwide", "🇺🇸 US only",
 * "Region not stated") and check against where the candidate lives. Tokens come from the crawler
 * (`apps/crawler/src/job_crawler/eligibility.py`, `jobs.open_to`): ISO country codes, "WORLDWIDE",
 * or region tokens.
 */

export const WORLDWIDE = "WORLDWIDE";

/** Region tokens the crawler emits. */
export const REGION_TOKENS = [
  "EUROPE",
  "EMEA",
  "APAC",
  "ASIA",
  "SEA",
  "LATAM",
  "NORTH_AMERICA",
  "AMERICAS",
  "OCEANIA",
  "MIDDLE_EAST",
  "AFRICA",
] as const;
export type RegionToken = (typeof REGION_TOKENS)[number];

/** Mirror of `COUNTRY_REGIONS` in eligibility.py: the regions a candidate in that country is part of. */
export const COUNTRY_REGIONS: Record<string, RegionToken[]> = {
  VN: ["APAC", "ASIA", "SEA"],
  TH: ["APAC", "ASIA", "SEA"],
  MY: ["APAC", "ASIA", "SEA"],
  SG: ["APAC", "ASIA", "SEA"],
  ID: ["APAC", "ASIA", "SEA"],
  PH: ["APAC", "ASIA", "SEA"],
  IN: ["APAC", "ASIA"],
  JP: ["APAC", "ASIA"],
  KR: ["APAC", "ASIA"],
  AU: ["APAC", "OCEANIA"],
  NZ: ["APAC", "OCEANIA"],
  US: ["NORTH_AMERICA", "AMERICAS"],
  CA: ["NORTH_AMERICA", "AMERICAS"],
  MX: ["LATAM", "AMERICAS", "NORTH_AMERICA"],
  BR: ["LATAM", "AMERICAS"],
  AR: ["LATAM", "AMERICAS"],
  GB: ["EUROPE", "EMEA"],
  DE: ["EUROPE", "EMEA"],
  FR: ["EUROPE", "EMEA"],
  NL: ["EUROPE", "EMEA"],
  ES: ["EUROPE", "EMEA"],
  PL: ["EUROPE", "EMEA"],
};

export function isRegionToken(token: string): token is RegionToken {
  return (REGION_TOKENS as readonly string[]).includes(token);
}

export type RemoteScope = "worldwide" | "restricted" | "unknown";

export interface RemoteAccess {
  /** worldwide = anyone; restricted = only the listed countries/regions; unknown = posting doesn't say. */
  scope: RemoteScope;
  /** Countries (ISO codes) and regions the job is open to, countries first; empty unless restricted. */
  places: string[];
  /** Does it accept a candidate living in `basedIn`? null when unknown or no `basedIn`. */
  acceptsCandidate: boolean | null;
}

/** Classify a remote job's `open_to` tokens and check them against the candidate's country. */
export function remoteAccess(openTo: string[] | null | undefined, basedIn?: string | null): RemoteAccess {
  if (!openTo?.length) return { scope: "unknown", places: [], acceptsCandidate: null };
  if (openTo.includes(WORLDWIDE)) return { scope: "worldwide", places: [], acceptsCandidate: basedIn ? true : null };
  const countries = openTo.filter((t) => !isRegionToken(t));
  const regions = openTo.filter(isRegionToken);
  const places = [...new Set([...countries, ...regions])];
  if (!basedIn) return { scope: "restricted", places, acceptsCandidate: null };
  const ok = new Set<string>([basedIn, ...(COUNTRY_REGIONS[basedIn] ?? [])]);
  return { scope: "restricted", places, acceptsCandidate: places.some((p) => ok.has(p)) };
}

/** Best guess of the country someone lives in from their IANA time zone (only zones we can map
 * to one country; null otherwise). Used as the default for "I'm based in" when nothing is saved. */
const ZONE_COUNTRY: Record<string, string> = {
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Bangkok": "TH",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Singapore": "SG",
  "Asia/Jakarta": "ID",
  "Asia/Manila": "PH",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Pacific/Auckland": "NZ",
  "Europe/London": "GB",
  "Europe/Berlin": "DE",
  "Europe/Paris": "FR",
  "Europe/Amsterdam": "NL",
  "Europe/Madrid": "ES",
  "Europe/Warsaw": "PL",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Phoenix": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Edmonton": "CA",
  "America/Winnipeg": "CA",
  "America/Halifax": "CA",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Buenos_Aires": "AR",
};

export function countryForZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  if (zone.startsWith("Australia/")) return "AU";
  return ZONE_COUNTRY[zone] ?? null;
}
