import type { MetadataRoute } from "next";
import { listings, snapshotDate } from "@/lib/seo-jobs";
import { SITE_URL } from "@/lib/site";
import { listingPath } from "./jobs/seo-ui";

export const dynamic = "force-static";

/**
 * Public pages and the static listing pages (`/jobs/tech/…`, `/jobs/country/…`,
 * `/jobs/source/…`). Job pages are in their own sitemaps (`/jobs/sitemap/<n>.xml`, see
 * app/jobs/sitemap.ts); robots.txt lists all of them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const built = snapshotDate();
  const listingUrls = (["tech", "country", "source"] as const).flatMap((kind) =>
    listings(kind).map((l) => ({ url: `${SITE_URL}${listingPath(kind, l.key)}`, lastModified: built })),
  );
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/jobs/`, lastModified: built, changeFrequency: "daily", priority: 0.8 },
    ...listingUrls,
    { url: `${SITE_URL}/privacy/`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
