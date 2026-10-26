// Shared React UI. Web-only for now; the Expo app will reuse these through react-native-web
// or a NativeWind port (milestone 3).
import type { Job } from "@ujc/core";
import { sourceMeta } from "@ujc/core";

export function SourceBadge({ source }: { source: string }) {
  const meta = sourceMeta(source);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: meta.color }}
      title={`Crawled from ${meta.label}`}
    >
      {meta.label}
    </span>
  );
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-AU");
}

export function JobCard({ job }: { job: Job }) {
  const posted = timeAgo(job.postedAt ?? job.firstSeenAt);
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {job.title}
            </a>
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
            {job.remote ? " · Remote" : ""}
          </p>
        </div>
        <SourceBadge source={job.source} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {job.salaryText ? <span>{job.salaryText}</span> : null}
        {job.employmentType ? <span>{job.employmentType}</span> : null}
        {posted ? <span>{posted}</span> : null}
        {job.tags.slice(0, 5).map((t) => (
          <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}
