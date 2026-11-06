"use client";

import { useState } from "react";
import type { TechCategory } from "@ujc/core";
import { techInfo } from "@ujc/core";
import { Chip, fuzzyFilter, SearchField, TechIcon, useUiStrings } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { getJobFacets } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const CATEGORIES: TechCategory[] = ["frontend", "backend", "mobile", "database", "cloud"];

export interface TechGroup {
  category: TechCategory;
  label: string;
  ids: string[];
}

/**
 * Every technology `GET /api/jobs/facets` returned (it sends the whole list), grouped by category
 * and most common first, narrowed by `query` (fuzzy, in the browser). Selected ids always stay.
 *
 * This used to show only the frontend and backend groups, ten chips each: AWS, Kubernetes,
 * Docker, PostgreSQL, React Native… (25 of the 45 techs) were never offered.
 */
export function useTechGroups(selected: readonly string[], query: string): { groups: TechGroup[]; counts: Map<string, number> } {
  const { t } = useTranslation("home");
  const { data } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const facets = data?.tech ?? [];
  const counts = new Map(facets.map((f) => [f.id, f.count]));
  const all = [...facets.map((f) => f.id), ...selected.filter((id) => !counts.has(id))];
  const shown = query.trim()
    ? fuzzyFilter(all, query, (id) => [techInfo(id).label, id, t(`tech.${techInfo(id).category}`)])
    : all;
  const groups = CATEGORIES.map((category) => ({
    category,
    label: t(`tech.${category}`),
    ids: shown.filter((id) => techInfo(id).category === category),
  })).filter((g) => g.ids.length > 0);
  return { groups, counts };
}

/**
 * Tech filter (Slack request: "filter by which tech stacks appear"): chips per category, most
 * common first, from `GET /api/jobs/facets`, with a search box to narrow the chips. Several
 * selected = jobs mentioning all of them.
 */
export function TechFilter({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation("home");
  const strings = useUiStrings();
  const [query, setQuery] = useState("");
  const { groups, counts } = useTechGroups(value, query);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-col gap-2">
      <SearchField
        value={query}
        onChange={setQuery}
        label={t("tech.searchLabel")}
        placeholder={t("tech.searchPlaceholder")}
        className="w-full sm:max-w-xs"
      />
      {query && groups.length === 0 ? <p className="text-subheadline text-label-secondary">{strings.noMatches}</p> : null}
      {groups.map(({ category, label, ids }) => (
        <div key={category} role="group" aria-label={`${label} tech`} className="flex flex-wrap items-center gap-2">
          <span className="w-20 shrink-0 text-footnote font-semibold text-label-secondary">{label}</span>
          {ids.map((id) => (
            <Chip
              key={id}
              selected={value.includes(id)}
              onClick={() => toggle(id)}
              icon={
                <span className="inline-flex rounded-[5px] bg-white/90 p-0.5">
                  <TechIcon id={id} size={14} />
                </span>
              }
            >
              {techInfo(id).label}
              {counts.has(id) ? <span className="text-caption opacity-70">{counts.get(id)}</span> : null}
            </Chip>
          ))}
        </div>
      ))}
    </div>
  );
}
