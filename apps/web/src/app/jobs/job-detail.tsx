"use client";

import Link from "next/link";
import type { Job, JobDetail as JobDetailType } from "@ujc/core";
import { sortTech, sourceMeta, techInfo } from "@ujc/core";
import {
  Avatar,
  Badge,
  buttonClasses,
  Card,
  ChevronRightIcon,
  cx,
  employmentLabel,
  ExternalLinkIcon,
  LevelBadge,
  LocationText,
  MapPinIcon,
  matchBand,
  MatchBadge,
  RemoteAccessBadge,
  DescriptionSkeleton,
  SourceBadge,
  SourceIcon,
  TechIcon,
} from "@ujc/ui";
import { SaveJobButton } from "@/app/save-job-button";
import { RemoteAccessCard } from "@/app/remote-access-card";
import { SkyScene } from "@/app/sky-scene";
import { useWorkHoursPhase, WorkHoursCard } from "@/app/work-hours";
import { useBasedIn } from "@/lib/based-in";
import { Highlighted, matchedTerms } from "@/lib/highlight";
import { useTranslation } from "react-i18next";
import { hasRecognisedSections, JdSections } from "./jd-sections";
import { JobVotePanel } from "./job-vote";

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
  /** Panel only: the job's own page (`/jobs/<slug>/`), shown as an "Open job page" link. */
  pageHref?: string;
}

/** Everything about one job: header, badges, Track, CV fit, description and Apply. Shared by the
 * job detail page and the home page's detail panel so both always show the same thing. */
export function JobDetail({
  job,
  loadingDescription = false,
  signedIn,
  highlight = [],
  variant = "page",
  pageHref,
}: JobDetailProps) {
  const description = "description" in job ? job.description : null;
  // Canonical sections when the parser recognised some; otherwise the plain description.
  const sections = "sections" in job && hasRecognisedSections(job.sections) ? job.sections : null;
  const matches = highlight.length ? matchedTerms(`${job.title}\n${description ?? ""}`, highlight) : [];
  const applyHref = job.applyUrl ?? job.url;
  const source = sourceMeta(job.source).label;
  const { country: basedIn } = useBasedIn();
  const phase = useWorkHoursPhase()(job);
  const { t } = useTranslation("job");
  return (
    <article className="relative isolate flex flex-col gap-4">
      {/* The sky at the job's hours on your clock, bleeding to the panel's padded corner. */}
      {phase ? <SkyScene phase={phase} size={variant === "panel" ? "panel-bleed" : "panel"} /> : null}
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
        <LevelBadge level={job.level} source={job.levelSource} />
        {job.remote ? (
          <Badge tone="neutral" className="max-w-full">
            <RemoteAccessBadge openTo={job.openTo} basedIn={basedIn} />
          </Badge>
        ) : null}
        {job.relocation?.support != null ? (
          <Badge tone={job.relocation.support ? "success" : "neutral"}>
            {t(job.relocation.support ? "relocation.support" : "relocation.noSupport")}
          </Badge>
        ) : null}
        {job.relocation?.required ? <Badge tone="info">{t("relocation.required")}</Badge> : null}
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
            <SourceIcon source={job.source} size={16} decorative />
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
        {variant === "panel" && pageHref ? (
          // Plain client navigation, no prefetch: selecting jobs in the list never fetches pages,
          // and Back returns to the list exactly as it was (view cache).
          <Link
            href={pageHref}
            prefetch={false}
            className={buttonClasses({ variant: "plain", size: "md", className: "rounded-full px-3" })}
          >
            Open job page
            <ChevronRightIcon size={16} />
          </Link>
        ) : null}
      </div>

      {/* Community check ("Not worth applying?" / "Still good"), high up so a flagged job warns
          before anyone reads the whole description. */}
      <JobVotePanel job={job} signedIn={signedIn} />

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
        <div className="hairline-t pt-4">
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

      <div className="hairline-t pt-4">
        <h2 className="text-title3 text-label">{sections ? t("sections.heading") : "About the role"}</h2>
        {loadingDescription ? (
          <div aria-busy="true" aria-label={t("loadingDescriptionAria")}>
            <DescriptionSkeleton />
          </div>
        ) : sections ? (
          <div className="mt-3">
            <JdSections sections={sections} highlight={highlight} />
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
              <SourceIcon source={job.source} size={20} decorative />
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
              <SourceIcon source={job.source} size={20} decorative />
              Apply on {source}
            </a>
          </div>
        </>
      ) : null}
    </article>
  );
}
