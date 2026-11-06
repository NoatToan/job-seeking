import type { NextConfig } from "next";

// Static-export SPA: no database access, no server code. All data comes from fetch calls to
// apps/api (see docs/product/ARCHITECTURE.md §3). NEXT_PUBLIC_API_BASE_URL is read at build time.
/** Stars of the public repo, read once at build time (production is rebuilt daily), so visitors
 * never hit GitHub's unauthenticated rate limit. Any failure = 0 (the link shows no count). */
async function githubStars(): Promise<number> {
  try {
    const res = await fetch("https://api.github.com/repos/NoatToan/job-seeking", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { stargazers_count?: number };
    return data.stargazers_count ?? 0;
  } catch {
    return 0;
  }
}

const nextConfig = async (): Promise<NextConfig> => ({
  env: { NEXT_PUBLIC_GITHUB_STARS: String(await githubStars()) },
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@ujc/core", "@ujc/ui", "@contributor-box/react"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
});

export default nextConfig;
