import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses, NavBar } from "@ujc/ui";
import { allJobs, listings } from "@/lib/seo-jobs";
import { OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { Breadcrumbs, ListingLinks, SeoJobList, Section } from "./seo-ui";

const TITLE = "Browse tech jobs by stack, country and source";
const DESCRIPTION =
  "Remote and relocation tech jobs grouped by tech stack, country and job board, refreshed every morning. Every job links to the original posting.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/jobs/" },
  openGraph: { ...OPEN_GRAPH, url: "/jobs/", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

const LATEST = 30;

/** `/jobs/`: hub of the static SEO pages (listings + the newest job pages). */
export default function JobsHubPage() {
  const latest = allJobs().slice(0, LATEST);
  return (
    <>
      <NavBar title="Browse jobs" largeTitle={false} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-12">
        <Breadcrumbs items={[{ name: "Jobs", href: "/jobs/" }]} />
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-title1 font-bold tracking-[-0.02em] text-label">{TITLE}</h1>
          <p className="text-body text-label-secondary">{DESCRIPTION}</p>
          <p>
            <Link href="/" className={buttonClasses({ variant: "tinted", size: "sm", className: "rounded-full px-4" })}>
              Search and filter every job
            </Link>
          </p>
        </header>
        <Section title="By tech stack" id="by-tech">
          <ListingLinks items={listings("tech")} label="Jobs by tech stack" />
        </Section>
        <Section title="By country" id="by-country">
          <ListingLinks items={listings("country").slice(0, 40)} label="Jobs by country" />
        </Section>
        <Section title="By job board" id="by-source">
          <ListingLinks items={listings("source")} label="Jobs by job board" />
        </Section>
        {latest.length ? (
          <Section title="Newest jobs" id="newest-jobs">
            <SeoJobList jobs={latest} label="Newest jobs" />
          </Section>
        ) : null}
      </main>
    </>
  );
}
