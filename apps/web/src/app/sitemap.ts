import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Public pages only. Job pages are `/jobs/view/?id=…`, rendered in the browser from the API, so
 * they are not listed here; crawlers reach them through the links in the home list.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/privacy/`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
