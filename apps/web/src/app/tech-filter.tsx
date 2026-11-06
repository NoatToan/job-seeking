"use client";

import type { TechCategory } from "@ujc/core";
import { techInfo } from "@ujc/core";
import { Chip, TechIcon } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { getJobFacets } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** Chips per group: the most common technologies in the crawled jobs. */
const PER_GROUP = 10;

/**
 * Tech filter (Slack request: "filter by which tech stacks appear"): frontend and backend chips,
 * most common first, from `GET /api/jobs/facets`. Several selected = jobs mentioning all of them.
 */
export function TechFilter({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation("home");
  const GROUPS: { category: TechCategory; label: string }[] = [
    { category: "frontend", label: t("tech.frontend") },
    { category: "backend", label: t("tech.backend") },
  ];
  const { data } = useApi(getJobFacets, [], { cacheKey: "facets" });
  const counts = new Map((data?.tech ?? []).map((t) => [t.id, t.count]));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-col gap-2">
      {GROUPS.map(({ category, label }) => {
        const ids = (data?.tech ?? [])
          .map((t) => t.id)
          .filter((id) => techInfo(id).category === category)
          .slice(0, PER_GROUP);
        // Keep a selected chip visible even if it isn't in the top list.
        for (const id of value) if (techInfo(id).category === category && !ids.includes(id)) ids.push(id);
        if (!ids.length) return null;
        return (
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
        );
      })}
    </div>
  );
}
