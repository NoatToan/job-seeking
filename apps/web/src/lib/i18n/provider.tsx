"use client";

import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { SegmentedControl, UiStringsProvider } from "@ujc/ui";
import type { UiStrings } from "@ujc/ui";
import i18n, { detectLanguage, LANGUAGES, saveLanguage } from "./index";
import type { Language } from "./index";

const DATE_LOCALE: Record<Language, string> = { en: "en-AU", vi: "vi-VN" };

/** The active UI language, narrowed to the ones we ship ("en" until detection has run). */
export function useLanguage(): { language: Language; setLanguage: (lng: Language) => void; dateLocale: string } {
  const { i18n: instance } = useTranslation();
  const language = (LANGUAGES.find((l) => l.code === instance.resolvedLanguage)?.code ?? "en") as Language;
  return {
    language,
    setLanguage: (lng) => {
      saveLanguage(lng);
      void instance.changeLanguage(lng);
    },
    dateLocale: DATE_LOCALE[language],
  };
}

/** Feeds the shared `@ujc/ui` components their words in the active language. */
function UiStringsBridge({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const { language, dateLocale } = useLanguage();
  const value = useMemo<UiStrings>(
    () => ({
      locale: dateLocale,
      search: t("ui.search"),
      clearSearch: t("ui.clearSearch"),
      select: t("ui.select"),
      searchEllipsis: t("ui.searchEllipsis"),
      noMatches: t("ui.noMatches"),
      remove: t("ui.remove"),
      close: t("ui.close"),
      dismiss: t("ui.dismiss"),
      progress: t("ui.progress"),
      mainNav: t("ui.mainNav"),
      remote: t("ui.remote"),
      remoteOpenTo: (openTo) => t("ui.remoteOpenTo", { openTo }),
      remoteAccess: {
        worldwide: t("ui.remoteAccess.worldwide"),
        only: (places) => t("ui.remoteAccess.only", { places }),
        unknown: t("ui.remoteAccess.unknown"),
        openToYou: (country) => t("ui.remoteAccess.openToYou", { country }),
        notOpenToYou: (country) => t("ui.remoteAccess.notOpenToYou", { country }),
        stampOpen: t("ui.remoteAccess.stampOpen"),
        stampClosed: t("ui.remoteAccess.stampClosed"),
        regions: t("ui.remoteAccess.regions", { returnObjects: true }) as Record<string, string>,
      },
      read: t("ui.read"),
      viewDetails: t("ui.viewDetails"),
      opensInNewTab: t("ui.opensInNewTab"),
      skillsToBrushUp: t("ui.skillsToBrushUp"),
      via: (source) => t("ui.via", { source }),
      today: t("ui.today"),
      daysAgo: (count) => t("ui.daysAgo", { count }),
      fit: { great: t("ui.fit.great"), good: t("ui.fit.good"), worth: t("ui.fit.worth"), long: t("ui.fit.long") },
    }),
    // `language` changes `t`'s output without changing `t`'s identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, language, dateLocale],
  );
  return <UiStringsProvider value={value}>{children}</UiStringsProvider>;
}

/**
 * i18n for the app (Slack request: "bilingual, default from the browser language, switchable,
 * remembered in a cookie"). The static export is prerendered in English, so the first client
 * render is English too (no hydration mismatch); right after mount we switch to the language
 * from the `ujc_locale` cookie, else the browser's language list, and keep `<html lang>` in step.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const syncLang = (lng: string) => {
      document.documentElement.lang = LANGUAGES.find((l) => lng.startsWith(l.code))?.code ?? "en";
    };
    i18n.on("languageChanged", syncLang);
    // Saved choice (cookie) → browser language list → English.
    void i18n.changeLanguage(detectLanguage());
    return () => i18n.off("languageChanged", syncLang);
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <UiStringsBridge>{children}</UiStringsBridge>
    </I18nextProvider>
  );
}

/** "EN | VI" switch for the top bar and the account sheet. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  const { language, setLanguage } = useLanguage();
  return (
    <SegmentedControl
      label={t("language.label")}
      size="sm"
      value={language}
      onChange={setLanguage}
      // A flag reads faster than "EN / VI"; the language name stays the accessible name.
      options={LANGUAGES.map((l) => ({
        value: l.code,
        label: (
          <span aria-hidden className="text-[1.05rem] leading-none">
            {l.flag}
          </span>
        ),
        ariaLabel: l.label,
      }))}
      className={className}
    />
  );
}
