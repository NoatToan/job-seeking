"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { openToLabel, sourceMeta } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  ChevronLeftIcon,
  employmentLabel,
  EmptyState,
  ExternalLinkIcon,
  GlobeIcon,
  matchBand,
  MatchBadge,
  NavBar,
  Skeleton,
  SourceBadge,
} from "@ujc/ui";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const BACK_LINK = (
  <Link
    href="/"
    className="inline-flex items-center gap-0.5 rounded-control-sm px-1 text-body text-tint hover:underline focus-ring"
  >
    <ChevronLeftIcon size={20} />
    Feed
  </Link>
);

export function JobView() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { data: job, loading, error, reload } = useApi(() => getJob(id), [id]);

  if (!id) {
    return (
      <>
        <NavBar title="Job details" largeTitle={false} leading={BACK_LINK} />
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <EmptyState
            tone="error"
            illustration="error"
            title="Missing job id"
            message="We couldn't tell which job to show."
            action={
              <Link href="/" className={buttonClasses({ size: "sm" })}>
                Back to your feed
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <NavBar title={job?.company ?? "Job details"} largeTitle={false} leading={BACK_LINK} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 pb-28 sm:pb-10">
        {loading ? (
          <div aria-busy="true" aria-label="Loading job" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title="We couldn't load this job"
            message={error.message}
            action={
              <Button variant="gray" onClick={reload}>
                Try again
              </Button>
            }
          />
        ) : job ? (
          <article className="flex flex-col gap-5">
            <div>
              <h1 className="text-title1 text-label">{job.title}</h1>
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
              {job.description ? (
                <p className="mt-2 max-w-2xl whitespace-pre-line text-body text-label">{job.description}</p>
              ) : (
                <p className="mt-2 text-body text-label-secondary">No description provided.</p>
              )}
            </div>

            <div className="hidden sm:block">
              <a
                href={job.applyUrl ?? job.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ size: "lg" })}
              >
                Apply on {sourceMeta(job.source).label}
                <ExternalLinkIcon size={16} />
              </a>
            </div>
            <div className="fixed inset-x-0 bottom-0 z-20 material-bar hairline-t p-4 sm:hidden">
              <a
                href={job.applyUrl ?? job.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ size: "lg", fullWidth: true })}
              >
                Apply on {sourceMeta(job.source).label}
              </a>
            </div>
          </article>
        ) : null}
      </main>
    </>
  );
}
