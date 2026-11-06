"use client";

import { useState } from "react";
import type { ElementType, MouseEvent, ReactNode } from "react";
import type { Job } from "@ujc/core";
import { openToLabel, sortTech } from "@ujc/core";
import { cx } from "../cx";
import { CheckIcon, ChevronRightIcon, ClockIcon, GlobeIcon, MapPinIcon } from "../icons";
import { Badge, MatchBadge, SourceBadge } from "./badges";
import { Avatar } from "./feedback";
import { TechStackRow } from "./tech-icon";

/** "2 days ago" style label from an ISO date; null when unknown. */
export function timeAgo(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-AU");
}

/** "full_time" -> "Full-time". */
export function employmentLabel(value: string | null): string | null {
  if (!value) return null;
  const v = value.replace(/[_\s]+/g, "-").toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export interface JobCardProps {
  job: Job;
  /** In-app details page (e.g. `/jobs/view?id=`). Adds a "View details" row. */
  detailsHref?: string;
  /** Link component for `detailsHref` (Next `Link`). Default "a". */
  linkAs?: ElementType;
  /** Action buttons (Save, Applied, Hide), shown bottom-right. */
  actions?: ReactNode;
  /** Application status badge (tracker), shown next to the source. */
  status?: ReactNode;
  className?: string;
}

/**
 * One job in a list. Hierarchy: title > company/location > fit + source > reasons > meta.
 * The title links to the original posting (new tab); the source badge is always visible.
 */
export function JobCard({ job, detailsHref, linkAs: LinkAs = "a", actions, status, className }: JobCardProps) {
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const posted = timeAgo(job.postedAt ?? job.firstSeenAt);
  const openTo = openToLabel(job.openTo);
  const employment = employmentLabel(job.employmentType);
  return (
    <article
      className={cx(
        "flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card transition-shadow duration-300 hover:shadow-raised",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={job.company || job.title} shape="rounded" size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="text-headline text-label">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control-sm hover:text-tint-ink hover:underline focus-ring"
            >
              {job.title}
              <span className="sr-only"> (opens original posting in a new tab)</span>
            </a>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-subheadline text-label-secondary">
            <span className="font-medium">{job.company}</span>
            {job.location ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon size={13} aria-hidden />
                  {job.location}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {job.match ? <MatchBadge score={job.match.score} variant="ring" size={44} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={job.source} />
        {job.remote ? (
          <Badge tone="info" icon={<GlobeIcon size={12} strokeWidth={2.25} />}>
            {openTo ? `Remote · ${openTo}` : "Remote"}
          </Badge>
        ) : null}
        {status}
      </div>

      {job.match ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={scoreExpanded}
            onClick={() => setScoreExpanded((prev) => !prev)}
            className="inline-flex w-fit items-center gap-1 rounded-control-sm text-subheadline font-medium text-tint hover:underline focus-ring"
          >
            Why this score
            <ChevronRightIcon
              size={14}
              strokeWidth={2.25}
              aria-hidden
              className={cx("transition-transform duration-200", scoreExpanded && "rotate-90")}
            />
          </button>
          {scoreExpanded ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-callout text-label">{job.match.summary}</p>
              {job.match.missingSkills.length ? (
                <p className="text-footnote text-label-secondary">
                  <span className="font-medium">Skills to brush up:</span> {job.match.missingSkills.slice(0, 4).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-footnote text-label-secondary">
        {job.salaryText ? <span className="font-medium text-label">{job.salaryText}</span> : null}
        {employment ? <span>{employment}</span> : null}
        {posted ? (
          <span className="inline-flex items-center gap-1">
            <ClockIcon size={13} aria-hidden />
            {posted}
          </span>
        ) : null}
        {job.tags.slice(0, 5).map((t) => (
          <span key={t} className="rounded-control-sm bg-fill-tertiary px-1.5 py-0.5 text-caption text-label-secondary">
            {t}
          </span>
        ))}
      </div>

      {detailsHref || actions ? (
        <div className="-mx-1 flex items-center justify-between gap-2 hairline-t pt-2">
          {detailsHref ? (
            <LinkAs
              href={detailsHref}
              className="inline-flex h-9 items-center gap-0.5 rounded-control px-1 text-subheadline font-semibold text-tint hover:underline focus-ring"
            >
              View details
              <ChevronRightIcon size={15} strokeWidth={2.25} aria-hidden />
            </LinkAs>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
    </article>
  );
}

export interface JobListItemProps {
  job: Job;
  /** In-app details page; the whole row links there (small screens / open in new tab). */
  href: string;
  /** Link component for `href` (Next `Link`). Default "a". */
  linkAs?: ElementType;
  /** Highlighted as the job shown in the detail panel. */
  selected?: boolean;
  /** Click on the row. Call `event.preventDefault()` to stay on the list (wide screens). */
  onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Small action buttons (Save), kept clickable above the row link. */
  actions?: ReactNode;
  /** Extra badges after source / remote (e.g. working-hours fit). */
  meta?: ReactNode;
  /** Already read: dimmed with a "Read" mark so unread jobs stand out. */
  viewed?: boolean;
  className?: string;
}

/**
 * Compact job row for the list + detail layout: just enough to scan (title, company, place, source,
 * age, fit), while the detail panel on the right carries the rest. The whole row is one link
 * (stretched `::after`), so it still works as a plain link on phones and with ⌘-click.
 */
export function JobListItem({
  job,
  href,
  linkAs: LinkAs = "a",
  selected = false,
  onSelect,
  actions,
  meta,
  viewed = false,
  className,
}: JobListItemProps) {
  const posted = timeAgo(job.postedAt ?? job.firstSeenAt);
  return (
    <article
      data-job-id={job.id}
      data-viewed={viewed ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "relative flex scroll-my-1 gap-3 rounded-card p-3 transition-[background-color,box-shadow] duration-200 ease-spring",
        // Inset ring + accent bar: stays fully visible inside a scrolling list (an outer ring or a
        // translate would be clipped by the list's overflow).
        selected
          ? "bg-tint-soft shadow-card ring-2 ring-inset ring-tint/50 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-tint"
          : "bg-grouped-secondary shadow-card hover:shadow-raised",
        viewed && !selected && "opacity-60 hover:opacity-100",
        className,
      )}
    >
      <Avatar name={job.company || job.title} shape="rounded" size={32} />
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-subheadline font-semibold text-label">
          <LinkAs
            href={href}
            onClick={onSelect}
            className="rounded-control-sm after:absolute after:inset-0 after:rounded-card focus-ring"
          >
            {job.title}
          </LinkAs>
        </h3>
        <p className="mt-0.5 truncate text-footnote text-label-secondary">
          <span className="font-medium">{job.company}</span>
          {job.location ? ` · ${job.location}` : ""}
        </p>
        {job.salaryText ? (
          <p className="mt-0.5 truncate text-footnote font-medium text-label">{job.salaryText}</p>
        ) : null}
        {job.techStack?.length ? <TechStackRow ids={sortTech(job.techStack)} className="mt-1.5" /> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-caption text-label-secondary">
          <SourceBadge source={job.source} />
          {job.remote ? (
            <Badge tone="info" icon={<GlobeIcon size={11} strokeWidth={2.25} />}>
              Remote
            </Badge>
          ) : null}
          {meta}
          {posted ? <span>{posted}</span> : null}
          {viewed ? (
            <span className="inline-flex items-center gap-0.5 text-label-secondary">
              <CheckIcon size={12} strokeWidth={2.5} aria-hidden />
              Read
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {job.match ? <MatchBadge score={job.match.score} /> : <span />}
        {actions ? <div className="relative z-10 flex items-center gap-1">{actions}</div> : null}
      </div>
    </article>
  );
}
