import { Suspense } from "react";
import { JobView } from "./job-view";

export default function JobViewPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-body text-label-secondary">Loading job…</p>}>
      <JobView />
    </Suspense>
  );
}
