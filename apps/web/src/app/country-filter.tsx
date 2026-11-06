"use client";

import { FuzzySelect, GlobeIcon } from "@ujc/ui";
import type { SelectOption } from "@ujc/ui";
import { getJobFacets } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** "DE" -> "Germany" (falls back to the code on runtimes without Intl.DisplayNames). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Country filter (Slack request): jobs located in / open to one country (`jobs.countries`).
 * Options come from `GET /api/jobs/facets`, most common first, with job counts.
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
  const { data } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const options = data?.countries ?? [];
  const choices: SelectOption[] = [
    { value: "", label: "All countries" },
    ...(value && !options.some((o) => o.code === value) ? [{ value, label: countryName(value), keywords: value }] : []),
    ...options.map((o) => ({
      value: o.code,
      label: countryName(o.code),
      hint: String(o.count),
      keywords: o.code,
    })),
  ];
  const select = (
    <FuzzySelect
      label="Country"
      value={value}
      onChange={onChange}
      options={choices}
      placeholder="All countries"
      searchPlaceholder="Type a country…"
      variant={compact ? "pill" : "field"}
    />
  );
  if (compact) return select;
  return (
    <span className="flex items-center gap-2 text-subheadline text-label-secondary">
      <GlobeIcon size={15} aria-hidden />
      <span>Country</span>
      {select}
    </span>
  );
}
