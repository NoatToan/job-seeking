import type { MetadataRoute } from "next";
import { jobPagePath } from "@/lib/job-url";
import { allJobs } from "@/lib/seo-jobs";
import { SITE_URL } from "@/lib/site";

// Static export: prerendered at build time, one file per chunk (`/jobs/sitemap/0.xml`, …).
export const dynamic = "force-static";

/** URLs per job sitemap file; Google's limit is 50,000 (and 50 MB). */
export const JOBS_PER_SITEMAP = 40000;

export function jobSitemapCount(): number {
  return Math.max(1, Math.ceil(allJobs().length / JOBS_PER_SITEMAP));
}

export async function generateSitemaps() {
  return Array.from({ length: jobSitemapCount() }, (_, id) => ({ id }));
}

/** Every static job page, with `lastmod` = the last crawl that still found the job. */
export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  return allJobs()
    .slice(id * JOBS_PER_SITEMAP, (id + 1) * JOBS_PER_SITEMAP)
    .map((job) => ({ url: `${SITE_URL}${jobPagePath(job)}`, lastModified: job.lastSeenAt }));
}
