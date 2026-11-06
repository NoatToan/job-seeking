import type { Metadata } from "next";
import { Suspense } from "react";
import { JobView } from "./job-view";

// The job itself loads in the browser (`?id=`); `JobView` then sets the real title and
// description. Not indexed: one URL for every job, so the indexable copy of a job is its static
// page `/jobs/<slug>/` (canonical + JobPosting there). `follow` keeps its links crawlable.
export const metadata: Metadata = {
  title: "Job details",
  description: "Job details, salary, tech stack and working hours compared with your time zone.",
  robots: { index: false, follow: true },
};

export default function JobViewPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-body text-label-secondary">Loading job…</p>}>
      <JobView />
    </Suspense>
  );
}
