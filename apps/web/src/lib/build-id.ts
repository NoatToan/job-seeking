/**
 * The commit this SPA was built from (`NEXT_PUBLIC_BUILD_ID`, set in next.config.ts from Vercel's
 * `VERCEL_GIT_COMMIT_SHA`). The API sends the same value as `X-Build-Id` on every response
 * (apps/api ujc_api/cache_control.py), so a tab still running an older build can tell that a new
 * deploy went out and drop its client-side caches. "" when unknown (local dev).
 */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** Response header carrying the API deployment's build id. */
export const BUILD_ID_HEADER = "X-Build-Id";
