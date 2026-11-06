"use client";

import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { sortTech, sourceMeta, techInfo } from "@ujc/core";
import {
  Avatar,
  Badge,
  buttonClasses,
  Card,
  cx,
  employmentLabel,
  ExternalLinkIcon,
  LocationText,
  MapPinIcon,
  matchBand,
  MatchBadge,
  RemoteAccessBadge,
  Skeleton,
  SourceBadge,
  TechIcon,
} from "@ujc/ui";
import { SaveJobButton } from "@/app/save-job-button";
import { RemoteAccessCard } from "@/app/remote-access-card";
import { WorkHoursCard } from "@/app/work-hours";
import { useBasedIn } from "@/lib/based-in";
import { Highlighted, matchedTerms } from "@/lib/highlight";

export interface JobDetailProps {
  /** The list row is enough for the header; `description` arrives with `GET /api/jobs/{id}`. */
  job: Job | JobDetailType;
  /** `true` while the full job (description) is still loading. */
  loadingDescription?: boolean;
  signedIn: boolean;
  /** Words to highlight (the current search, selected techs, feed keywords) — see lib/highlight. */
  highlight?: readonly string[];
  /** "page" = `/jobs/view` (sticky Apply bar on phones); "panel" = right-hand pane on the home page. */
  variant?: "page" | "panel";
}

/** Everything about one job: header, badges, Track, CV fit, description and Apply. Shared by the
 * job detail page and the home page's detail panel so both always show the same thing. */
export function JobDetail({
  job,
  loadingDescription = false,
  signedIn,
  highlight = [],
  variant = "page",
}: JobDetailProps) {
  const description = "description" in job ? job.description : null;
  const matches = highlight.length ? matchedTerms(`${job.title}\n${description ?? ""}`, highlight) : [];
  const applyHref = job.applyUrl ?? job.url;
  const source = sourceMeta(job.source).label;
  const { country: basedIn } = useBasedIn();
  return (
    <article className="flex flex-col gap-5">
      <header className="flex items-start gap-4">
        <Avatar name={job.company || job.title} shape="rounded" size={56} className="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="text-subheadline font-semibold text-label">{job.company}</p>
          <h1
            className={cx(
              "mt-0.5 font-display font-bold tracking-[-0.02em] text-label",
              variant === "panel" ? "text-title2" : "text-title1",
            )}
          >
            <Highlighted text={job.title} terms={highlight} />
          </h1>
          {job.location ? (
            <p className="mt-1 inline-flex items-center gap-1 text-subheadline text-label-secondary">
              <MapPinIcon size={14} aria-hidden />
              <span>
                <LocationText text={job.location} />
              </span>
            </p>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={job.source} />
        {job.remote ? (
          <Badge tone="neutral" className="max-w-full">
            <RemoteAccessBadge openTo={job.openTo} basedIn={basedIn} />
          </Badge>
        ) : null}
        {employmentLabel(job.employmentType) ? <Badge>{employmentLabel(job.employmentType)}</Badge> : null}
        {job.salaryText ? (
          <Badge title={job.salary?.source === "description" ? "Found in the job description" : undefined}>
            {job.salaryText}
            {job.salary?.source === "description" ? " · from description" : ""}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {variant === "panel" ? (
          <a
            href={applyHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ size: "md", className: "rounded-full px-5" })}
          >
            Apply on {source}
            <ExternalLinkIcon size={16} />
          </a>
        ) : null}
        <SaveJobButton
          key={job.id}
          jobId={job.id}
          label="Track"
          savedLabel="Tracked ✓"
          size="md"
          signedIn={signedIn}
        />
      </div>

      <RemoteAccessCard job={job} />

      {matches.length ? (
        <p aria-label="Matches your search" className="flex flex-wrap items-center gap-1.5 text-footnote text-label-secondary">
          <span className="font-semibold">Matches your search:</span>
          {matches.map((t) => (
            <mark key={t} className="rounded-control-sm bg-warning-soft px-1.5 py-0.5 font-medium text-label">
              {t}
            </mark>
          ))}
        </p>
      ) : null}

      {job.techStack?.length ? (
        <div className="hairline-t pt-5">
          <h2 className="text-headline text-label">Tech stack</h2>
          <ul aria-label="Tech stack" className="mt-2 flex flex-wrap gap-1.5">
            {sortTech(job.techStack).map((id) => (
              <li
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-separator bg-background px-2.5 py-1 text-footnote font-medium text-label"
              >
                <TechIcon id={id} size={14} />
                {techInfo(id).label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WorkHoursCard job={job} />

      {job.match ? (
        <Card className="bg-tint-soft shadow-none">
          <div className="flex items-center gap-3">
            <MatchBadge score={job.match.score} variant="ring" size={56} />
            <p className="text-headline text-label">{matchBand(job.match.score).label}</p>
          </div>
          <p className="mt-2 text-body text-label">{job.match.summary}</p>
          {job.match.missingSkills.length ? (
            <p className="mt-1 text-footnote text-label-secondary">
              <span className="font-medium">Skills to brush up:</span> {job.match.missingSkills.join(", ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="hairline-t pt-5">
        <h2 className="text-title3 text-label">About the role</h2>
        {loadingDescription ? (
          <div aria-busy="true" aria-label="Loading description" className="mt-3 flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className={i === 5 ? "h-3 w-2/3" : "h-3 w-full"} />
            ))}
          </div>
        ) : description ? (
          <p className="mt-2 max-w-2xl whitespace-pre-line text-body leading-relaxed text-label">
            <Highlighted text={description} terms={highlight} />
          </p>
        ) : (
          <p className="mt-2 text-body text-label-secondary">No description provided.</p>
        )}
      </div>

      {job.tags?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {job.tags.slice(0, 12).map((t) => (
            <span key={t} className="rounded-control-sm bg-fill-tertiary px-1.5 py-0.5 text-caption text-label-secondary">
              {t}
            </span>
          ))}
        </div>
      ) : null}

      {variant === "page" ? (
        <>
          <div className="hidden sm:block">
            <a href={applyHref} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "lg" })}>
              Apply on {source}
              <ExternalLinkIcon size={16} />
            </a>
          </div>
          <div className="fixed inset-x-0 bottom-0 z-20 material-bar hairline-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:hidden">
            <a
              href={applyHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ size: "lg", fullWidth: true })}
            >
              Apply on {source}
            </a>
          </div>
        </>
      ) : null}
    </article>
  );
}
