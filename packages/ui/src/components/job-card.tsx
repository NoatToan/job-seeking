"use client";

import { useState } from "react";
import type { ElementType, MouseEvent, ReactNode } from "react";
import type { Job } from "@ujc/core";
import { sortTech } from "@ujc/core";
import { cx } from "../cx";
import { EN_UI_STRINGS, useUiStrings } from "../strings";
import type { UiStrings } from "../strings";
import { CheckIcon, ChevronRightIcon, ClockIcon, EyeIcon, GlobeIcon, MapPinIcon } from "../icons";
import { Badge, MatchBadge, SourceBadge, SourceDot } from "./badges";
import { LevelBadge } from "./level-badge";
import { Avatar } from "./feedback";
import { AccessStamp, AccessStampFold, fitsCandidate, RemoteAccessBadge } from "./remote-access";
import { LocationText } from "./location-text";
import { TechStackRow } from "./tech-icon";

/** "2 days ago" style label from an ISO date; null when unknown. */
export function timeAgo(iso: string | null, now: number = Date.now(), strings: UiStrings = EN_UI_STRINGS): string | null {
  if (!iso) return null;
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return strings.today;
  if (days < 30) return strings.daysAgo(days);
  return new Date(iso).toLocaleDateString(strings.locale);
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
  /** Candidate's country (ISO): colours the remote region for "open to you or not". */
  basedIn?: string | null;
  className?: string;
}

/**
 * One job in a list. Hierarchy: title > company/location > fit + source > reasons > meta.
 * The title links to the original posting (new tab); the source badge is always visible.
 */
export function JobCard({ job, detailsHref, linkAs: LinkAs = "a", actions, status, basedIn, className }: JobCardProps) {
  const [scoreExpanded, setScoreExpanded] = useState(false);
  const strings = useUiStrings();
  const posted = timeAgo(job.postedAt ?? job.firstSeenAt, Date.now(), strings);
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
              <span className="sr-only"> {strings.opensInNewTab}</span>
            </a>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-subheadline text-label-secondary">
            <span className="font-medium">{job.company}</span>
            {job.location ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon size={13} aria-hidden />
                  <span>
                    <LocationText text={job.location} />
                  </span>
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
          <Badge tone="neutral" className="max-w-full">
            <RemoteAccessBadge openTo={job.openTo} basedIn={basedIn} />
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
                  <span className="font-medium">{strings.skillsToBrushUp}</span> {job.match.missingSkills.slice(0, 4).join(", ")}
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
              {strings.viewDetails}
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
  /** Candidate's country (ISO): colours the remote region green / red for "open to you or not". */
  basedIn?: string | null;
  /** Decorative layer behind the content (absolutely positioned with a negative z-index, e.g. a
   * sky scene); the row is its own stacking context, so it paints above the row background. */
  backdrop?: ReactNode;
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
  basedIn,
  backdrop,
  className,
}: JobListItemProps) {
  const strings = useUiStrings();
  const posted = timeAgo(job.postedAt ?? job.firstSeenAt, Date.now(), strings);
  // Rows with the "For you" ribbon get extra top padding so it never sits on the avatar or title.
  const stamped = Boolean(job.remote) && fitsCandidate(job.openTo, basedIn);
  return (
    <article
      data-job-id={job.id}
      data-viewed={viewed ? "true" : undefined}
      data-stamped={stamped ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "group relative isolate flex scroll-my-1 gap-3 rounded-[18px] border p-3.5 data-[stamped=true]:pt-8 transition-[background-color,border-color,box-shadow] duration-200 ease-spring",
        // Border colour (not an outer ring) marks the selection, so it is never clipped by the
        // scrolling list's overflow.
        selected
          ? "border-tint/60 bg-[color-mix(in_srgb,var(--ujc-tint)_6%,var(--ujc-background))] shadow-raised"
          : "border-separator bg-background hover:border-control-border/50 hover:shadow-raised",
        className,
      )}
    >
      {backdrop}
      {stamped ? (
        <>
          <AccessStamp openTo={job.openTo} basedIn={basedIn} />
          <AccessStampFold openTo={job.openTo} basedIn={basedIn} />
        </>
      ) : null}
      <Avatar
        name={job.company || job.title}
        shape="rounded"
        size={40}
        className={cx("rounded-xl", viewed && !selected && "opacity-60")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3
            className={cx(
              "line-clamp-2 min-w-0 flex-1 text-subheadline font-semibold leading-snug",
              viewed && !selected ? "text-label-secondary" : "text-label",
            )}
          >
            <LinkAs
              href={href}
              onClick={onSelect}
              className="rounded-control-sm after:absolute after:inset-0 after:rounded-[18px] focus-ring"
            >
              {job.title}
            </LinkAs>
          </h3>
          {job.match ? <MatchBadge score={job.match.score} className="shrink-0" /> : null}
        </div>
        <p className="mt-0.5 truncate text-footnote text-label-secondary">
          <span className="font-medium text-label">{job.company}</span>
          {job.location ? (
            <>
              {" · "}
              <LocationText text={job.location} />
            </>
          ) : null}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote">
          <LevelBadge level={job.level} source={job.levelSource} size="sm" />
          {job.salaryText ? <span className="truncate font-semibold text-success-ink">{job.salaryText}</span> : null}
          {job.remote ? <RemoteAccessBadge openTo={job.openTo} basedIn={basedIn} /> : null}
        </div>
        {job.techStack?.length ? <TechStackRow ids={sortTech(job.techStack)} className="mt-2" /> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        <div className="mt-2 flex items-center gap-2 text-caption text-label-tertiary">
          <SourceDot source={job.source} />
          {posted ? (
            <>
              <span aria-hidden>·</span>
              <span>{posted}</span>
            </>
          ) : null}
          {viewed ? (
            // Icon only (an open eye): the word stays as the tooltip and for screen readers.
            <span title={strings.read} className="ml-auto inline-flex items-center text-label-tertiary">
              <EyeIcon size={15} strokeWidth={2} />
              <span className="sr-only">{strings.read}</span>
            </span>
          ) : null}
          {actions ? (
            <div className={cx("relative z-10 flex items-center gap-1", !viewed && "ml-auto")}>{actions}</div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
