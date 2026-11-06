import { countryName } from "./components/remote-access";

/**
 * Extra words a country option answers to, beyond its label in the UI language: the ISO code, the
 * English and Vietnamese names (so "viet", "việt nam", "duc", "my" all work whatever the UI
 * language is) and common aliases Intl doesn't give ("USA", "UK", "Holland").
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["USA", "America", "United States of America", "Mỹ"],
  GB: ["UK", "Britain", "Great Britain", "England", "Scotland", "Wales", "Anh"],
  VN: ["Vietnam", "Viet Nam"],
  KR: ["Korea", "South Korea"],
  KP: ["North Korea"],
  AE: ["UAE", "Emirates", "Dubai"],
  NL: ["Holland"],
  CZ: ["Czech Republic", "Czechia"],
  CN: ["PRC"],
  JP: ["Nhật"],
  AU: ["Aus", "Úc"],
  TR: ["Turkey", "Türkiye"],
  CI: ["Ivory Coast"],
  CH: ["Swiss"],
  RU: ["Russia"],
};

export function countryKeywords(code: string): string[] {
  const upper = code.toUpperCase();
  return [upper, countryName(upper, "en"), countryName(upper, "vi"), ...(COUNTRY_ALIASES[upper] ?? [])];
}

/** Cities people search by whose IANA zone is named after another city, plus country names. */
const ZONE_ALIASES: Record<string, string[]> = {
  "Asia/Ho_Chi_Minh": ["Saigon", "Sài Gòn", "Hồ Chí Minh", "Hanoi", "Hà Nội", "Da Nang", "Đà Nẵng", "Vietnam", "Việt Nam", "ICT"],
  "Asia/Bangkok": ["Thailand", "Thái Lan"],
  "Asia/Kolkata": ["Calcutta", "India", "Mumbai", "Bangalore", "Delhi"],
  "Asia/Shanghai": ["China", "Beijing"],
  "Asia/Manila": ["Philippines"],
  "Asia/Jakarta": ["Indonesia"],
  "Asia/Tokyo": ["Japan"],
  "Asia/Seoul": ["Korea"],
  "Asia/Dubai": ["UAE", "Emirates"],
  "Australia/Sydney": ["Australia", "Canberra"],
  "Europe/London": ["UK", "Britain", "England", "GMT", "BST"],
  "Europe/Berlin": ["Germany"],
  "Europe/Kyiv": ["Kiev", "Ukraine"],
  "America/New_York": ["NYC", "Eastern", "Boston", "Washington", "Toronto"],
  "America/Chicago": ["Central", "Texas", "Dallas", "Austin"],
  "America/Denver": ["Mountain"],
  "America/Los_Angeles": ["LA", "Pacific", "San Francisco", "Seattle", "California"],
  "America/Sao_Paulo": ["Brazil", "Brasil"],
  "Pacific/Auckland": ["New Zealand", "NZ"],
};

export function zoneKeywords(zone: string): string[] {
  return ZONE_ALIASES[zone] ?? [];
}
