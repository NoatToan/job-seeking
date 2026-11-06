/**
 * Routes that work for a signed-out visitor: the home page (public job catalogue), job detail
 * (`/jobs/view/`) and the static SEO pages (`/jobs/`, `/jobs/<slug>/`, `/jobs/tech/…`). Shared
 * between `session.tsx` (so the global 401 handler never bounces an anonymous visitor away from
 * one of these) and `nav.tsx` (so the app shell still renders its chrome on them while signed out).
 */
// Everything under /jobs/ is public. A signed-in-only screen must not be added under /jobs/.
const PUBLIC_ROUTE_PREFIXES = ["/jobs/"];

export function isPublicRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/jobs") return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
