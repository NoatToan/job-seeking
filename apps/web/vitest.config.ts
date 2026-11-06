import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/vitest.setup.ts"],
    // Several tests wait up to 5 s for async UI; under a cold, parallel `pnpm -r test` run the
    // default 5 s per-test budget was too tight and made feed.test.tsx flaky.
    testTimeout: 15_000,
  },
});
