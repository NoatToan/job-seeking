// Shared React UI. Web-only for now; the Expo app will reuse these through react-native-web
// or a NativeWind port (milestone 3).
import type { Job } from "@ujc/core";
import { openToLabel, sourceMeta } from "@ujc/core";

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

export function MatchBadge({ score }: { score: number }) {
  const color = score >= 85 ? "#15803d" : score >= 70 ? "#65a30d" : score >= 50 ? "#ca8a04" : "#9ca3af";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
      title="CV fit score (Claude)"
    >
      {score}
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
            {job.remote ? ` · Remote${openToLabel(job.openTo) ? ` (${openToLabel(job.openTo)})` : ""}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {job.match ? <MatchBadge score={job.match.score} /> : null}
          <SourceBadge source={job.source} />
        </div>
      </div>
      {job.match ? (
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          {job.match.summary}
          {job.match.missingSkills.length ? (
            <span className="text-zinc-500"> · thiếu: {job.match.missingSkills.slice(0, 4).join(", ")}</span>
          ) : null}
        </p>
      ) : null}
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
