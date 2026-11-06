"use client";

import type { JobDetail as JobDetailType } from "@ujc/core";
import { useSession } from "@/lib/session";
import { useMarkViewedAfterDwell } from "@/lib/viewed";
import { JobDetail } from "../job-detail";

/** The shared job detail (same as `/jobs/view` and the home panel), with the visitor's session for
 * Track. Prerendered signed out; Track turns into the real button once the session loads. */
export function JobPageDetail({ job }: { job: JobDetailType }) {
  const { me } = useSession();
  // Opening the full page counts as reading it straight away (same as /jobs/view).
  useMarkViewedAfterDwell(job.id, 0);
  return <JobDetail job={job} signedIn={Boolean(me)} />;
}
