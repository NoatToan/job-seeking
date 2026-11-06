import type { Metadata } from "next";
import { Suspense } from "react";
import { JobView } from "./job-view";

// The job itself loads in the browser (`?id=`); `JobView` then sets the real title, description
// and schema.org `JobPosting`. This is the fallback before it does.
export const metadata: Metadata = {
  title: "Job details",
  description: "Job details, salary, tech stack and working hours compared with your time zone.",
};

export default function JobViewPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-body text-label-secondary">Loading job…</p>}>
      <JobView />
    </Suspense>
  );
}
