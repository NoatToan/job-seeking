import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Local dev: env lives in the repo root (shared with the Python crawler). Vercel injects it instead.
const rootEnv = path.join(__dirname, "../../.env.local");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
