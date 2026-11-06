import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses, NavBar } from "@ujc/ui";
import { homeFilterHref, LISTING_PAGE_SIZE, listing, listings, withPlaceholder } from "@/lib/seo-jobs";
import type { ListingKind } from "@/lib/seo-jobs";
import { OPEN_GRAPH, SITE_NAME, SITE_URL } from "@/lib/site";
import { jobPagePath } from "@/lib/job-url";
import { Breadcrumbs, JsonLd, ListingLinks, listingPath, listingTitle, SeoJobList, Section } from "./seo-ui";

/**
 * Static listing page (`/jobs/tech/react/`, `/jobs/country/de/`, `/jobs/source/himalayas/`): the
 * newest jobs for one tech, country or source, as crawlable links to their job pages. Only
 * listings with at least `MIN_LISTING_JOBS` jobs exist (no thin pages). JobPosting markup stays on
 * the job pages (Google: never on list pages); here an `ItemList` of the job URLs instead.
 */

const INTRO: Record<ListingKind, (label: string, count: number) => string> = {
  tech: (label, count) =>
    `${count} open ${label} jobs from company job boards and remote job sites, refreshed every morning. Each job links to the original posting.`,
  country: (label, count) =>
    `${count} open tech jobs in or open to candidates in ${label}, refreshed every morning. Each job links to the original posting.`,
  source: (label, count) =>
    `${count} open tech jobs we found on ${label}, refreshed every morning. Each job links to the original posting on ${label}.`,
};

export function listingParams(kind: ListingKind): Array<{ key: string }> {
  return withPlaceholder(listings(kind).map((l) => ({ key: l.key })), "key");
}

export function listingMetadata(kind: ListingKind, key: string): Metadata {
  const found = listing(kind, key);
  if (!found) return {};
  const title = listingTitle(found);
  const description = INTRO[kind](found.label, found.jobs.length).slice(0, 155);
  const url = listingPath(kind, key);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, url, title: `${title} · ${SITE_NAME}`, description },
    twitter: { card: "summary_large_image", title: `${title} · ${SITE_NAME}`, description },
  };
}

export function ListingPage({ kind, listingKey }: { kind: ListingKind; listingKey: string }) {
  const found = listing(kind, listingKey);
  if (!found) notFound();
  const title = listingTitle(found);
  const shown = found.jobs.slice(0, LISTING_PAGE_SIZE);
  const others = (["tech", "country", "source"] as const).flatMap((k) =>
    listings(k)
      .filter((l) => !(k === kind && l.key === listingKey))
      .slice(0, k === "tech" ? 16 : 8),
  );
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    numberOfItems: shown.length,
    itemListElement: shown.map((job, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}${jobPagePath(job)}` })),
  };

  return (
    <>
      <NavBar title={title} largeTitle={false} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-12">
        <Breadcrumbs items={[{ name: "Jobs", href: "/jobs/" }, { name: title, href: listingPath(kind, listingKey) }]} />
        <JsonLd data={ld} />
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-title1 font-bold tracking-[-0.02em] text-label">{title}</h1>
          <p className="text-body text-label-secondary">{INTRO[kind](found.label, found.jobs.length)}</p>
          <p>
            <Link href={homeFilterHref(kind, listingKey)} className={buttonClasses({ variant: "tinted", size: "sm", className: "rounded-full px-4" })}>
              Filter these jobs live
            </Link>
          </p>
        </header>
        <Section title={shown.length < found.jobs.length ? `Newest ${shown.length} of ${found.jobs.length}` : "Open jobs"} id="listing-jobs">
          <SeoJobList jobs={shown} label={title} />
        </Section>
        <Section title="Browse more jobs" id="browse-more">
          <ListingLinks items={others} label="Browse more jobs" />
        </Section>
      </main>
    </>
  );
}
