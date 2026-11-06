import { afterEach } from "vitest";
import { clearViewCache } from "@/lib/view-cache";
import { resetViewedForTests } from "@/lib/viewed";

// The view cache and the read-jobs store are module-level by design (they survive client
// navigations); tests must not see each other's cached lists, filters, job details or reads.
afterEach(() => {
  clearViewCache();
  resetViewedForTests();
  window.localStorage.clear();
});
