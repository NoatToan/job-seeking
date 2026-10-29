import { Suspense } from "react";
import Link from "next/link";
import { JobView } from "./job-view";

export default function JobViewPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <Link href="/" className="text-sm underline">
        ← All jobs
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading job…</p>}>
        <JobView />
      </Suspense>
    </main>
  );
}
