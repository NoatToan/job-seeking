/**
 * Routes that work for a signed-out visitor: the home page (public job catalogue), job
 * detail and the blog. Shared between `session.tsx` (so the global 401 handler never bounces an anonymous
 * visitor away from one of these) and `nav.tsx` (so the app shell still renders its chrome on
 * them while signed out).
 */
const PUBLIC_ROUTE_PREFIXES = ["/jobs/view", "/blog"];

export function isPublicRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
