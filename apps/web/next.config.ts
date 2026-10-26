import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ujc/core", "@ujc/ui"],
  cacheComponents: true,
  partialPrefetching: true,
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
