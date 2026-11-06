/**
 * Public site identity for SEO (metadata, sitemap, robots, JSON-LD). `NEXT_PUBLIC_SITE_URL` is
 * read at build time; set it when the app moves to its own domain so canonical URLs follow.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://unified-job-crawler.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "JobSeeking";
export const SITE_TITLE = "JobSeeking — remote & relocation tech jobs from every board";
export const SITE_DESCRIPTION =
  "Remote and relocation tech jobs from LinkedIn, Seek, Glassdoor, Himalayas, We Work Remotely, Arc and more in one place, refreshed every morning. Filter by tech stack, country, salary and working hours, and match jobs to your CV.";

/** Signed-in screens and tooling: never indexed (robots.ts also disallows them). */
export const NO_INDEX = { index: false, follow: false } as const;

/** Shared Open Graph fields. A page that sets `openGraph` replaces the layout's whole object, so
 * it spreads this first. */
export const OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  locale: "en_US",
} as const;
