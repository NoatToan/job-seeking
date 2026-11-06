import { loadSnapshot } from "@/lib/blog/data";
import { rssXml } from "@/lib/blog/model";

// Static export: rendered once at build time to out/blog/rss.xml.
export const dynamic = "force-static";

export function GET() {
  return new Response(rssXml(loadSnapshot()), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
