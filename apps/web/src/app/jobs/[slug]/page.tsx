import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sourceMeta } from "@ujc/core";
import { ChevronLeftIcon, NavBar } from "@ujc/ui";
import { jobIdFromPath, jobPagePath, jobSlug } from "@/lib/job-url";
import { jobMetaDescription, jobPostingJsonLd } from "@/lib/job-posting";
import { allJobs, jobById, listing, relatedJobs, withPlaceholder } from "@/lib/seo-jobs";
import type { Listing } from "@/lib/seo-jobs";
import { OPEN_GRAPH } from "@/lib/site";
import { Breadcrumbs, formatDate, JsonLd, ListingLinks, listingPath, listingTitle, SeoJobList, Section } from "../seo-ui";
import { JobPageDetail } from "./job-page-detail";

/**
 * Static, indexable page for one job (`/jobs/<title>-<company>-<id>/`, docs/product/ARCHITECTURE.md
 * D12). Prerendered at build time from the job snapshot: full HTML (title, description, canonical,
 * JobPosting JSON-LD, breadcrumbs, related jobs) without running any JavaScript. Only jobs in the
 * snapshot get a page; any other `/jobs/<slug>/` is a 404 (the 404 page forwards people to the
 * live `/jobs/view/?id=` page).
 */
export const dynamicParams = false;

interface Params {
  slug: string;
}

export function generateStaticParams(): Params[] {
  return withPlaceholder(allJobs().map((job) => ({ slug: jobSlug(job) })), "slug");
}

function jobFor(slug: string) {
  const id = jobIdFromPath(`/jobs/${slug}/`);
  const job = id ? jobById(id) : null;
  return job && jobSlug(job) === slug ? job : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const job = jobFor((await params).slug);
  if (!job) return {};
  const where = job.remote ? "Remote" : job.location;
  const title = `${job.title} at ${job.company}${where ? ` (${where})` : ""}`;
  const description = jobMetaDescription(job);
  const url = jobPagePath(job);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, type: "article", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

const BACK_LINK = (
  <Link
    href="/"
    className="inline-flex items-center gap-0.5 rounded-control-sm px-1 text-body text-tint hover:underline focus-ring"
  >
    <ChevronLeftIcon size={20} />
    Jobs
  </Link>
);

export default async function JobPage({ params }: { params: Promise<Params> }) {
  const job = jobFor((await params).slug);
  if (!job) notFound();

  const source = sourceMeta(job.source).label;
  const tech = (job.techStack ?? []).map((t) => listing("tech", t)).filter((l): l is Listing => l !== null);
  const places = (job.countries ?? []).map((c) => listing("country", c.toLowerCase())).filter((l): l is Listing => l !== null);
  const fromSource = listing("source", job.source);
  const browse = [...tech.slice(0, 6), ...places.slice(0, 3), ...(fromSource ? [fromSource] : [])];
  const primary = tech[0] ?? fromSource;
  const related = relatedJobs(job);
  const ld = jobPostingJsonLd(job, { countries: job.countries });
  const firstSeen = formatDate(job.firstSeenAt);
  const lastSeen = formatDate(job.lastSeenAt);

  return (
    <>
      <NavBar title={job.company} largeTitle={false} leading={BACK_LINK} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-6 sm:pb-12">
        <Breadcrumbs
          items={[
            { name: "Jobs", href: "/jobs/" },
            ...(primary ? [{ name: listingTitle(primary), href: listingPath(primary.kind, primary.key) }] : []),
            { name: job.title, href: jobPagePath(job) },
          ]}
        />
        {ld ? <JsonLd data={ld} /> : null}
        <div className="rounded-[22px] border border-separator bg-background p-5 shadow-raised sm:p-7">
          <JobPageDetail job={job} />
        </div>

        <aside
          aria-label="Where this job comes from"
          className="rounded-card border border-separator bg-grouped-secondary p-4 text-footnote text-label-secondary"
        >
          <p>
            Posted on <span className="font-semibold text-label">{source}</span>
            {firstSeen ? <> · found by JobSeeking on {firstSeen}</> : null}
            {lastSeen ? <> · still listed on {lastSeen}</> : null}.
          </p>
          <p className="mt-1">
            We link to the original posting and never take applications ourselves.{" "}
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-tint-ink hover:underline focus-ring"
            >
              See the original posting on {source}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </aside>

        {related.length ? (
          <Section title="More jobs like this" id="related-jobs">
            <SeoJobList jobs={related} label="More jobs like this" />
          </Section>
        ) : null}

        {browse.length ? (
          <Section title="Browse similar jobs" id="browse-jobs">
            <ListingLinks items={browse} label="Browse similar jobs" />
          </Section>
        ) : null}

        <p className="text-footnote text-label-secondary">
          <Link href="/" className="font-medium text-tint-ink hover:underline focus-ring">
            Search every job, filtered by tech stack, country, salary and working hours
          </Link>
        </p>
      </main>
    </>
  );
}
