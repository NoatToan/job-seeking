"use client";

import { useSearchParams } from "next/navigation";
import { openToLabel } from "@ujc/core";
import { SourceBadge } from "@ujc/ui";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";

export function JobView() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const { data: job, loading, error } = useApi(() => getJob(id), [id]);

  if (!id) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Missing job id.
      </p>
    );
  }
  if (loading) return <p className="text-sm text-zinc-500">Loading job…</p>;
  if (error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        Could not load this job: {error.message}
      </p>
    );
  }
  if (!job) return null;

  return (
    <article className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={job.source} />
        {job.remote ? (
          <span className="text-xs text-zinc-500">
            Remote{openToLabel(job.openTo) ? ` (${openToLabel(job.openTo)})` : ""}
          </span>
        ) : null}
      </div>
      <h1 className="text-2xl font-bold">{job.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {job.company}
        {job.location ? ` · ${job.location}` : ""}
      </p>
      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
        {job.salaryText ? <span>{job.salaryText}</span> : null}
        {job.employmentType ? <span>{job.employmentType}</span> : null}
      </div>
      <a
        href={job.applyUrl ?? job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        Apply / view posting
      </a>
      {job.description ? (
        <div className="whitespace-pre-line text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
          {job.description}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No description provided.</p>
      )}
    </article>
  );
}
