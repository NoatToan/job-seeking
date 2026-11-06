import { atomFeed, RELEASE_NOTES } from "@/lib/release-notes";
import { SITE_NAME, SITE_URL } from "@/lib/site";

// Static export: rendered once at build time to out/release-notes/feed.xml. Every push to main
// rebuilds the site, so the feed follows the committed release notes.
export const dynamic = "force-static";

export function GET() {
  return new Response(atomFeed(RELEASE_NOTES.entries, SITE_URL, SITE_NAME), {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8" },
  });
}
