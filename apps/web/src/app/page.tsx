import { Suspense } from "react";
import { JobsBrowser } from "./jobs-browser";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Unified Job Crawler</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Jobs crawled daily from open feeds and public company job boards. Every job shows where
          it came from and links to the original posting.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading jobs…</p>}>
        <JobsBrowser />
      </Suspense>
    </main>
  );
}
