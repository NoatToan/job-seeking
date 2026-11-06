"use client";

import { useId, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { JdSection, JdSectionKey } from "@ujc/core";
import { JD_SECTION_KEYS } from "@ujc/core";
import {
  BanknoteIcon,
  BriefcaseIcon,
  BuildingIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CodeIcon,
  cx,
  DocumentIcon,
  GiftIcon,
  HeartIcon,
  InfoIcon,
  ListChecksIcon,
  MapPinIcon,
  RouteIcon,
  SparklesIcon,
} from "@ujc/ui";
import type { IconProps } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { Highlighted, matchedTerms } from "@/lib/highlight";

/** One icon per canonical section, the same on every job. */
const SECTION_ICON: Record<JdSectionKey, ComponentType<IconProps>> = {
  intro: InfoIcon,
  about_company: BuildingIcon,
  about_role: BriefcaseIcon,
  responsibilities: ListChecksIcon,
  requirements: CheckCircleIcon,
  nice_to_have: SparklesIcon,
  tech_stack: CodeIcon,
  compensation: BanknoteIcon,
  benefits: GiftIcon,
  location_remote: MapPinIcon,
  hiring_process: RouteIcon,
  other: DocumentIcon,
  equal_opportunity: HeartIcon,
};

/** Sections longer than this start collapsed (with a "Show more"). */
export const COLLAPSE_CHARS = 900;
/** Benefits show as chips when every item is this short (and there are a handful of them). */
const CHIP_MAX_CHARS = 60;

/** A run of the section's text: a paragraph, a list, or a sub-heading ("Must have:"). */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "sub"; text: string }
  | { kind: "list"; items: string[] };

const BULLET = /^(?:- |\d{1,2}[.)] )/;

/** Splits a section body (plain text, "- " list items) into paragraphs, lists and sub-headings. */
export function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n").map((l) => l.trim());
  lines.forEach((line, i) => {
    if (!line) return;
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      return;
    }
    const next = lines.slice(i + 1).find(Boolean);
    const shortLabel = line.length <= 80 && !/[.!?]$/.test(line);
    if (shortLabel && (line.endsWith(":") || (next !== undefined && BULLET.test(next)))) {
      blocks.push({ kind: "sub", text: line.replace(/:$/, "") });
      return;
    }
    blocks.push({ kind: "p", text: line });
  });
  return blocks;
}

/** Canonical sections in display order, each with its parts in posting order. */
export function groupSections(sections: readonly JdSection[]): { key: JdSectionKey; parts: JdSection[] }[] {
  const order = new Map<string, number>(JD_SECTION_KEYS.map((k, i) => [k, i]));
  const groups = new Map<JdSectionKey, JdSection[]>();
  for (const s of sections) {
    const key: JdSectionKey = order.has(s.key) ? s.key : "other";
    if (!s.body?.trim()) continue;
    groups.set(key, [...(groups.get(key) ?? []), { ...s, key }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([key, parts]) => ({ key, parts }));
}

/** True when the description had at least one heading we know (else show it as plain text). */
export function hasRecognisedSections(sections: readonly JdSection[] | null | undefined): sections is JdSection[] {
  return Boolean(sections?.some((s) => s.key !== "intro" && s.key !== "other" && s.body?.trim()));
}

function sameHeading(a: string | null, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return a !== null && norm(a) === norm(b);
}

function chipItems(key: JdSectionKey, blocks: Block[]): string[] | null {
  if (key !== "benefits") return null;
  const lists = blocks.filter((b) => b.kind === "list");
  if (lists.length !== 1 || blocks.some((b) => b.kind === "p" && b.text.length > 160)) return null;
  const items = (lists[0] as { items: string[] }).items;
  return items.length >= 3 && items.length <= 16 && items.every((i) => i.length <= CHIP_MAX_CHARS) ? items : null;
}

function Blocks({ sectionKey, blocks, terms }: { sectionKey: JdSectionKey; blocks: Block[]; terms: readonly string[] }) {
  const chips = chipItems(sectionKey, blocks);
  const checklist = sectionKey === "requirements" || sectionKey === "nice_to_have";
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={i} className="text-body leading-relaxed text-label">
              <Highlighted text={block.text} terms={terms} />
            </p>
          );
        }
        if (block.kind === "sub") {
          return (
            <p key={i} className="pt-1 text-subheadline font-semibold text-label">
              <Highlighted text={block.text} terms={terms} />
            </p>
          );
        }
        if (chips && block.items === chips) {
          return (
            <ul key={i} className="flex flex-wrap gap-1.5" data-layout="chips">
              {block.items.map((item, j) => (
                <li
                  key={j}
                  className="rounded-full border border-separator bg-background px-3 py-1 text-footnote font-medium text-label"
                >
                  <Highlighted text={item} terms={terms} />
                </li>
              ))}
            </ul>
          );
        }
        if (checklist) {
          const Icon = sectionKey === "requirements" ? CheckCircleIcon : SparklesIcon;
          return (
            <ul key={i} className="flex flex-col gap-1.5" data-layout="checklist">
              {block.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 text-body leading-relaxed text-label">
                  <Icon
                    size={16}
                    aria-hidden
                    className={cx(
                      "mt-1 shrink-0",
                      sectionKey === "requirements" ? "text-success-ink" : "text-info-ink",
                    )}
                  />
                  <span className="min-w-0">
                    <Highlighted text={item} terms={terms} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5 text-body leading-relaxed text-label marker:text-label-tertiary">
            {block.items.map((item, j) => (
              <li key={j}>
                <Highlighted text={item} terms={terms} />
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

function SectionGroup({
  sectionKey,
  parts,
  terms,
}: {
  sectionKey: JdSectionKey;
  parts: JdSection[];
  terms: readonly string[];
}) {
  const { t } = useTranslation("job");
  const id = useId();
  const title = t(`sections.titles.${sectionKey}`);
  const Icon = SECTION_ICON[sectionKey];
  const text = parts.map((p) => p.body).join("\n");
  const searched = terms.length > 0 && matchedTerms(text, terms).length > 0;
  const collapsible = sectionKey === "equal_opportunity" || text.length > COLLAPSE_CHARS;
  // EEO starts closed; long sections start clamped, unless they hold a searched word.
  const [open, setOpen] = useState(searched || !collapsible);
  // `other` has no canonical name of its own: its posting heading is the title.
  const heading = sectionKey === "other" && parts.length === 1 && parts[0].heading ? parts[0].heading : title;
  const subtitle =
    sectionKey !== "other" && parts.length === 1 && parts[0].heading && !sameHeading(parts[0].heading, title)
      ? parts[0].heading
      : null;
  const eeoClosed = sectionKey === "equal_opportunity" && !open;
  return (
    <section aria-labelledby={`${id}-h`} data-section={sectionKey} className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-control bg-tint-soft text-tint-ink">
          <Icon size={17} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-h`} className="text-headline text-label">
            {heading}
          </h3>
          {subtitle ? (
            <p className="truncate text-footnote text-label-tertiary" title={t("sections.postingHeading", { heading: subtitle })}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>
      <div className="sm:pl-10.5">
        {eeoClosed ? (
          <p className="line-clamp-2 text-footnote text-label-secondary">{parts[0].summary || parts[0].body}</p>
        ) : (
          <div
            id={`${id}-body`}
            className={cx(
              "flex flex-col gap-3",
              collapsible && !open && "max-h-60 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
            )}
          >
            {parts.map((part, i) => (
              <div key={i} className="flex flex-col gap-2">
                {parts.length > 1 && part.heading ? (
                  <p className="text-subheadline font-semibold text-label">
                    <Highlighted text={part.heading} terms={terms} />
                  </p>
                ) : null}
                <Blocks sectionKey={sectionKey} blocks={toBlocks(part.body)} terms={terms} />
              </div>
            ))}
          </div>
        )}
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={eeoClosed ? undefined : `${id}-body`}
            onClick={() => setOpen((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 rounded-control-sm text-subheadline font-medium text-tint hover:underline focus-ring"
          >
            {open ? t("sections.showLess") : t("sections.showMore")}
            <ChevronDownIcon
              size={15}
              strokeWidth={2.25}
              aria-hidden
              className={cx("transition-transform duration-200", open && "rotate-180")}
            />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A job description laid out by canonical section (job_crawler.sections): fixed order, and the
 * same title, icon and style for each kind of section on every job, whatever the posting called
 * it. Requirements / Nice to have are checklists, short benefits are chips, long sections fold,
 * and the EEO statement starts folded.
 */
export function JdSections({ sections, highlight = [] }: { sections: readonly JdSection[]; highlight?: readonly string[] }): ReactNode {
  const { t } = useTranslation("job");
  const groups = groupSections(sections);
  const intro = groups.find((g) => g.key === "intro");
  return (
    <div aria-label={t("sections.aria")} className="flex max-w-2xl flex-col gap-6">
      {intro
        ? intro.parts.map((part, i) => (
            <Blocks key={i} sectionKey="intro" blocks={toBlocks(part.body)} terms={highlight} />
          ))
        : null}
      {groups
        .filter((g) => g.key !== "intro")
        .map((g) => (
          <SectionGroup key={g.key} sectionKey={g.key} parts={g.parts} terms={highlight} />
        ))}
    </div>
  );
}
