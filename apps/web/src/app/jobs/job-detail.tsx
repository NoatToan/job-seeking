"use client";

import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { openToLabel, sortTech, sourceMeta, techInfo } from "@ujc/core";
import {
  Badge,
  buttonClasses,
  Card,
  employmentLabel,
  ExternalLinkIcon,
  GlobeIcon,
  matchBand,
  MatchBadge,
  Skeleton,
  SourceBadge,
  TechIcon,
} from "@ujc/ui";
import { SaveJobButton } from "@/app/save-job-button";
import { WorkHoursCard } from "@/app/work-hours";

export interface JobDetailProps {
  /** The list row is enough for the header; `description` arrives with `GET /api/jobs/{id}`. */
  job: Job | JobDetailType;
  /** `true` while the full job (description) is still loading. */
  loadingDescription?: boolean;
  signedIn: boolean;
  /** "page" = `/jobs/view` (sticky Apply bar on phones); "panel" = right-hand pane on the home page. */
  variant?: "page" | "panel";
}

/** Everything about one job: header, badges, Track, CV fit, description and Apply. Shared by the
 * job detail page and the home page's detail panel so both always show the same thing. */
export function JobDetail({ job, loadingDescription = false, signedIn, variant = "page" }: JobDetailProps) {
  const description = "description" in job ? job.description : null;
  const applyHref = job.applyUrl ?? job.url;
  const source = sourceMeta(job.source).label;
  return (
    <article className="flex flex-col gap-5">
      <div>
        <h1 className={variant === "panel" ? "text-title2 text-label" : "text-title1 text-label"}>{job.title}</h1>
        <p className="mt-1 text-subheadline text-label-secondary">
          {job.company}
          {job.location ? ` · ${job.location}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={job.source} />
        {job.remote ? (
          <Badge tone="info" icon={<GlobeIcon size={12} strokeWidth={2.25} />}>
            {openToLabel(job.openTo) ? `Remote · ${openToLabel(job.openTo)}` : "Remote"}
          </Badge>
        ) : null}
        {employmentLabel(job.employmentType) ? <Badge>{employmentLabel(job.employmentType)}</Badge> : null}
        {job.salaryText ? <Badge>{job.salaryText}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {variant === "panel" ? (
          <a href={applyHref} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: "md" })}>
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

      {job.techStack?.length ? (
        <div>
          <h2 className="text-headline text-label">Tech stack</h2>
          <ul aria-label="Tech stack" className="mt-2 flex flex-wrap gap-1.5">
            {sortTech(job.techStack).map((id) => (
              <li
                key={id}
                className="inline-flex items-center gap-1.5 rounded-control-sm bg-fill-tertiary px-2 py-1 text-footnote font-medium text-label"
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

      <div>
        <h2 className="text-title3 text-label">About the role</h2>
        {loadingDescription ? (
          <div aria-busy="true" aria-label="Loading description" className="mt-3 flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className={i === 5 ? "h-3 w-2/3" : "h-3 w-full"} />
            ))}
          </div>
        ) : description ? (
          <p className="mt-2 max-w-2xl whitespace-pre-line text-body text-label">{description}</p>
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
          <div className="fixed inset-x-0 bottom-0 z-20 material-bar hairline-t p-4 sm:hidden">
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
