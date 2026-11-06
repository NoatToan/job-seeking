import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Static export: metadata routes must be prerendered at build time.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in screens and tooling: nothing to index (each page also sets `noindex`).
      disallow: ["/account/", "/cv/", "/tracker/", "/onboarding/", "/connections/", "/login/", "/search/", "/design/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
