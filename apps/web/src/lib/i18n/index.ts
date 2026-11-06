import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en_common from "./locales/en/common.json";
import vi_common from "./locales/vi/common.json";
import en_home from "./locales/en/home.json";
import vi_home from "./locales/vi/home.json";
import en_job from "./locales/en/job.json";
import vi_job from "./locales/vi/job.json";
import en_auth from "./locales/en/auth.json";
import vi_auth from "./locales/vi/auth.json";
import en_cv from "./locales/en/cv.json";
import vi_cv from "./locales/vi/cv.json";
import en_tracker from "./locales/en/tracker.json";
import vi_tracker from "./locales/vi/tracker.json";
import en_account from "./locales/en/account.json";
import vi_account from "./locales/vi/account.json";
import en_connections from "./locales/en/connections.json";
import vi_connections from "./locales/vi/connections.json";
import en_onboarding from "./locales/en/onboarding.json";
import vi_onboarding from "./locales/vi/onboarding.json";
import en_search from "./locales/en/search.json";
import vi_search from "./locales/vi/search.json";
import en_privacy from "./locales/en/privacy.json";
import vi_privacy from "./locales/vi/privacy.json";

/** Languages the UI ships in. Add one = add `locales/<code>/<namespace>.json` (same keys as en) + a row here. */
export const LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "vi", label: "Tiếng Việt", short: "VI" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];

/** Cookie that remembers the visitor's choice (Slack request: "save it so they don't pick again"). */
// Renamed from `ujc_lang`: the first release wrote "en" there for every visitor before detection ran.
export const LANGUAGE_COOKIE = "ujc_locale";

/** One namespace per area, as in `useTranslation(["cv"])`. Every key exists in en; vi falls back to en. */
export const NAMESPACES = ["common", "home", "job", "auth", "cv", "tracker", "account", "connections", "onboarding", "search", "privacy"] as const;

export const resources = {
  en: { common: en_common, home: en_home, job: en_job, auth: en_auth, cv: en_cv, tracker: en_tracker, account: en_account, connections: en_connections, onboarding: en_onboarding, search: en_search, privacy: en_privacy },
  vi: { common: vi_common, home: vi_home, job: vi_job, auth: vi_auth, cv: vi_cv, tracker: vi_tracker, account: vi_account, connections: vi_connections, onboarding: vi_onboarding, search: vi_search, privacy: vi_privacy },
};

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      resources,
      ns: [...NAMESPACES],
      defaultNS: "common",
      // Always start in English: that is what the static export prerendered, so the first client
      // render matches the HTML. `I18nProvider` then switches to the detected language after mount.
      lng: "en",
      fallbackLng: "en",
      supportedLngs: LANGUAGES.map((l) => l.code),
      // "vi-VN" → "vi", "en-AU" → "en".
      nonExplicitSupportedLngs: true,
      load: "languageOnly",
      interpolation: { escapeValue: false }, // React escapes already
      returnNull: false,
      react: { useSuspense: false },
    });
}

/** The visitor's saved choice (`ujc_lang` cookie), else the first supported browser language, else "en". */
export function detectLanguage(): Language {
  const supported = (code: string | undefined | null): Language | null =>
    LANGUAGES.find((l) => code?.toLowerCase().startsWith(l.code))?.code ?? null;
  const cookie = document.cookie.split("; ").find((c) => c.startsWith(`${LANGUAGE_COOKIE}=`));
  const saved = supported(cookie?.slice(LANGUAGE_COOKIE.length + 1));
  if (saved) return saved;
  for (const lng of navigator.languages ?? [navigator.language]) {
    const match = supported(lng);
    if (match) return match;
  }
  return "en";
}

/** Remembers an explicit choice for a year (only the switch writes it, so browser detection keeps
 * working for visitors who never picked). */
export function saveLanguage(lng: Language): void {
  document.cookie = `${LANGUAGE_COOKIE}=${lng}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export default i18n;
