import { afterEach } from "vitest";
import { clearViewCache } from "@/lib/view-cache";

// The view cache is module-level by design (it survives client navigations); tests must not
// see each other's cached lists, filters or job details.
afterEach(() => clearViewCache());
