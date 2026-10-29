import type { ElementType, ReactNode } from "react";
import type { Job } from "@ujc/core";
import { openToLabel } from "@ujc/core";
import { cx } from "../cx";
import { ChevronRightIcon, ClockIcon, GlobeIcon, MapPinIcon } from "../icons";
import { Badge, MatchBadge, SourceBadge } from "./badges";
import { Avatar } from "./feedback";

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
          <p className="text-callout text-label">{job.match.summary}</p>
          {job.match.missingSkills.length ? (
            <p className="text-footnote text-label-secondary">
              <span className="font-medium">Skills to brush up:</span> {job.match.missingSkills.slice(0, 4).join(", ")}
            </p>
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
