import { loadSnapshot } from "@/lib/blog/data";
import { sitemapXml } from "@/lib/blog/model";

// Static export: rendered once at build time to out/sitemap-blog.xml. Meant to be listed in the
// site's sitemap index (robots.txt / sitemap.xml), next to the main sitemap.
export const dynamic = "force-static";

export function GET() {
  return new Response(sitemapXml(loadSnapshot()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
