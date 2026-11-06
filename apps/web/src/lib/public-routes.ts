/**
 * Routes that work for a signed-out visitor: the home page (public job catalogue), job detail
 * (`/jobs/view/`), the static SEO pages (`/jobs/`, `/jobs/<slug>/`, `/jobs/tech/…`), the blog and
 * the roadmap.
 * Shared between `session.tsx` (so the global 401 handler never bounces an anonymous visitor away
 * from one of these) and `nav.tsx` (so the app shell still renders its chrome on them while signed out).
 */
// Everything under /jobs/, /blog/ and /roadmap/ is public. A signed-in-only screen must not be added there.
const PUBLIC_ROUTE_PREFIXES = ["/jobs/", "/blog", "/roadmap"];

export function isPublicRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/jobs") return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
