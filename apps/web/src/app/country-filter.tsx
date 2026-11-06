"use client";

import { useId } from "react";
import { GlobeIcon } from "@ujc/ui";
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
export function CountryFilter({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { data } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const id = useId();
  const options = data?.countries ?? [];
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-subheadline text-label-secondary">
      <GlobeIcon size={15} aria-hidden />
      <span>Country</span>
      <select
        id={id}
        aria-label="Country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[14rem] truncate rounded-control-sm bg-fill-tertiary px-2 py-1 text-subheadline text-label focus-ring"
      >
        <option value="">All countries</option>
        {value && !options.some((o) => o.code === value) ? <option value={value}>{countryName(value)}</option> : null}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {countryName(o.code)} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}
