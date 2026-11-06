"use client";

import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { Button, buttonClasses, ChevronLeftIcon, EmptyState, NavBar } from "@ujc/ui";
import { JobViewSkeleton } from "@/app/skeletons";
import { getJob } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useSession } from "@/lib/session";
import { useMarkViewedAfterDwell } from "@/lib/viewed";
import { JobSeo } from "@/lib/job-seo";
import { JobDetail } from "../job-detail";

const BACK_LINK = (
  <Link
    href="/"
    className="inline-flex items-center gap-0.5 rounded-control-sm px-1 text-body text-tint hover:underline focus-ring"
  >
    <ChevronLeftIcon size={20} />
    Jobs
  </Link>
);

export function JobView() {
  const { me } = useSession();
  const [id] = useQueryState("id", parseAsString.withDefault(""));
  const { data: job, loading, error, reload } = useApi(() => getJob(id), [id], { cacheKey: `job:${id}` });
  // Opening the full page counts as reading it straight away.
  useMarkViewedAfterDwell(job ? id : null, 0);

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
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:pb-10">
        {loading ? (
          <JobViewSkeleton />
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
          <div className="rounded-[22px] border border-separator bg-background p-5 shadow-raised sm:p-7">
            <JobSeo job={job} />
            <JobDetail job={job} signedIn={Boolean(me)} />
          </div>
        ) : null}
      </main>
    </>
  );
}
