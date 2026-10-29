import type { NextConfig } from "next";

// Static-export SPA: no database access, no server code. All data comes from fetch calls to
// apps/api (see docs/product/ARCHITECTURE.md §3). NEXT_PUBLIC_API_BASE_URL is read at build time.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@ujc/core", "@ujc/ui"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
