"use client";

import { CANDIDATE_COUNTRIES } from "@ujc/core";
import { countryKeywords, flagEmoji, FuzzySelect, GlobeIcon } from "@ujc/ui";
import type { SelectOption } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { getJobFacets } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useLanguage } from "@/lib/i18n/provider";

/** "DE" -> "Germany" (falls back to the code on runtimes without Intl.DisplayNames). `locale`
 * defaults to English so this stays directly testable without an i18n instance; the component
 * below passes the active `dateLocale` ("en-AU" / "vi-VN") so country names follow the UI language. */
export function countryName(code: string, locale: string = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Country filter (Slack request): jobs located in / open to one country (`jobs.countries`).
 * Options come from `GET /api/jobs/facets` (every country, most common first, with job counts) and
 * are searched in the browser by name in English and Vietnamese, ISO code and alias ("USA", "UK").
 */
export function CountryFilter({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (code: string) => void;
  /** Filter-bar pill: no icon or visible label. */
  compact?: boolean;
}) {
  const { t } = useTranslation("home");
  const { dateLocale } = useLanguage();
  const { data } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const options = data?.countries ?? [];
  const allCountries = t("country.allCountries");
  const choices: SelectOption[] = [
    { value: "", label: allCountries },
    ...(value && !options.some((o) => o.code === value)
      ? [{ value, label: countryName(value, dateLocale), keywords: countryKeywords(value) }]
      : []),
    ...options.map((o) => ({
      value: o.code,
      label: countryName(o.code, dateLocale),
      hint: String(o.count),
      keywords: countryKeywords(o.code),
    })),
  ];
  const select = (
    <FuzzySelect
      label={t("country.label")}
      value={value}
      onChange={onChange}
      options={choices}
      placeholder={allCountries}
      searchPlaceholder={t("country.searchPlaceholder")}
      variant={compact ? "pill" : "field"}
      // Countries are found by typing, even while the facets hold only a few.
      searchable
    />
  );
  if (compact) return select;
  return (
    <span className="flex items-center gap-2 text-subheadline text-label-secondary">
      <GlobeIcon size={15} aria-hidden />
      <span>{t("country.label")}</span>
      {select}
    </span>
  );
}

/** "I'm based in" options (profile, CV, onboarding): every candidate country, searchable by name in
 * English and Vietnamese, code and alias, with an empty "not set" row first. */
export function candidateCountryOptions(emptyLabel: string): SelectOption[] {
  return [
    { value: "", label: emptyLabel },
    ...CANDIDATE_COUNTRIES.map((c) => ({
      value: c.code,
      label: c.label,
      keywords: countryKeywords(c.code),
      icon: (
        <span aria-hidden className="text-[1rem] leading-none">
          {flagEmoji(c.code)}
        </span>
      ),
    })),
  ];
}
