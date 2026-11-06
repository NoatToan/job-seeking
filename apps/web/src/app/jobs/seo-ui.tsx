/**
 * Server-rendered building blocks of the static SEO pages (job pages and listings). Everything
 * here renders the same at build time and in the browser (absolute UTC dates, no "2 days ago",
 * nothing read from the visitor's settings), so hydration never disagrees with the HTML.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { sortTech, sourceMeta, techInfo } from "@ujc/core";
import { Avatar, ChevronRightIcon, flagEmoji } from "@ujc/ui";
import { jobPagePath } from "@/lib/job-url";
import { jsonLdString } from "@/lib/job-posting";
import { SITE_URL } from "@/lib/site";
import type { Listing, ListingKind, SeoJob } from "@/lib/seo-jobs";

const DATE = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "3 Nov 2026" (UTC, so build and browser agree). */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE.format(d);
}

/** The source's colour dot (like the UI kit's source dot, minus its translated "via" text, which
 * needs the client-side strings context). */
function SourceSwatch({ source }: { source: string }) {
  return (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: sourceMeta(source).color }} />
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

export interface Crumb {
  name: string;
  href: string;
}

/** Visible breadcrumb trail plus its schema.org `BreadcrumbList`. The last crumb is the page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_URL}${c.href}`,
    })),
  };
  return (
    <nav aria-label="Breadcrumb">
      <JsonLd data={ld} />
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-footnote text-label-secondary">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={c.href} className="inline-flex min-w-0 items-center gap-1">
              {last ? (
                <span aria-current="page" className="line-clamp-1 text-label">
                  {c.name}
                </span>
              ) : (
                <>
                  <Link href={c.href} className="rounded-control-sm text-tint-ink hover:underline focus-ring">
                    {c.name}
                  </Link>
                  <ChevronRightIcon size={14} aria-hidden className="shrink-0 text-label-tertiary" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** One job in a static list: a plain link to its page, styled like the home list rows. */
export function SeoJobRow({ job }: { job: SeoJob }) {
  const posted = formatDate(job.postedAt ?? job.firstSeenAt);
  return (
    <article className="group relative flex gap-3 rounded-[18px] border border-separator bg-background p-3.5 transition-[border-color,box-shadow] duration-200 hover:border-control-border/50 hover:shadow-raised">
      <Avatar name={job.company || job.title} shape="rounded" size={40} className="rounded-xl" />
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-subheadline font-semibold leading-snug text-label">
          <Link
            href={jobPagePath(job)}
            prefetch={false}
            className="rounded-control-sm after:absolute after:inset-0 after:rounded-[18px] focus-ring"
          >
            {job.title}
          </Link>
        </h3>
        <p className="mt-0.5 truncate text-footnote text-label-secondary">
          <span className="font-medium text-label">{job.company}</span>
          {job.location ? ` · ${job.location}` : job.remote ? " · Remote" : ""}
        </p>
        {job.salaryText ? (
          <p className="mt-1 truncate text-footnote font-semibold text-success-ink">{job.salaryText}</p>
        ) : null}
        {job.techStack?.length ? (
          // Words, not the icon row: icons inline their SVG paths, which made a 60-row listing
          // ~700 KB of HTML. Text is lighter and is what search engines read anyway.
          <p className="mt-1.5 line-clamp-1 text-caption text-label-secondary">
            {sortTech(job.techStack)
              .slice(0, 6)
              .map((id) => techInfo(id).label)
              .join(" · ")}
          </p>
        ) : null}
        <p className="mt-2 flex items-center gap-2 text-caption text-label-tertiary">
          <SourceSwatch source={job.source} />
          <span>
            via {sourceMeta(job.source).label}
            {posted ? ` · ${posted}` : ""}
          </span>
        </p>
      </div>
    </article>
  );
}

export function SeoJobList({ jobs, label }: { jobs: readonly SeoJob[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {jobs.map((job) => (
        <li key={job.id}>
          <SeoJobRow job={job} />
        </li>
      ))}
    </ul>
  );
}

export const LISTING_PATH: Record<ListingKind, string> = {
  tech: "/jobs/tech/",
  country: "/jobs/country/",
  source: "/jobs/source/",
};

export function listingPath(kind: ListingKind, key: string): string {
  return `${LISTING_PATH[kind]}${encodeURIComponent(key)}/`;
}

/** "React jobs", "Jobs in Germany", "Jobs from Himalayas". */
export function listingTitle(listing: Pick<Listing, "kind" | "label">): string {
  if (listing.kind === "tech") return `${listing.label} jobs`;
  if (listing.kind === "country") return `Jobs in ${listing.label}`;
  return `Jobs from ${listing.label}`;
}

/** Pill links to listing pages ("React · 412"). */
export function ListingLinks({ items, label }: { items: readonly Listing[]; label: string }) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((l) => (
        <li key={`${l.kind}:${l.key}`}>
          <Link
            href={listingPath(l.kind, l.key)}
            prefetch={false}
            className="inline-flex items-center gap-1.5 rounded-full border border-separator bg-background px-3 py-1 text-footnote font-medium text-label hover:border-tint/60 focus-ring"
          >
            {l.kind === "country" ? <span aria-hidden>{flagEmoji(l.key.toUpperCase())}</span> : null}
            {l.kind === "source" ? <SourceSwatch source={l.key} /> : null}
            {l.label}
            <span className="text-label-tertiary">{l.jobs.length}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-title3 font-semibold text-label">
        {title}
      </h2>
      {children}
    </section>
  );
}
