import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  clearViewCache,
  noteServerBuild,
  readViewCache,
  resetViewCacheBuildForTests,
  viewCacheBuild,
  writeViewCache,
} from "./view-cache";

function response(build: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (build) headers["X-Build-Id"] = build;
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

describe("view cache is versioned by build id", () => {
  beforeEach(() => {
    clearViewCache();
    resetViewCacheBuildForTests("build-a");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetViewCacheBuildForTests();
  });

  it("keeps entries while the API reports the same build", () => {
    writeViewCache("api:facets", { countries: [] });
    expect(noteServerBuild("build-a")).toBe(false);
    expect(noteServerBuild(null)).toBe(false);
    expect(noteServerBuild("")).toBe(false);
    expect(readViewCache("api:facets")).toEqual({ countries: [] });
  });

  it("drops every entry once when a new deploy answers", () => {
    writeViewCache("api:facets", { countries: [] });
    writeViewCache("list:public:newest", { items: [1, 2] });
    expect(noteServerBuild("build-b")).toBe(true);
    expect(readViewCache("api:facets")).toBeUndefined();
    expect(readViewCache("list:public:newest")).toBeUndefined();
    expect(viewCacheBuild()).toBe("build-b");
    // Entries written under the new build survive further responses from it.
    writeViewCache("api:facets", { countries: ["AU"] });
    expect(noteServerBuild("build-b")).toBe(false);
    expect(readViewCache("api:facets")).toEqual({ countries: ["AU"] });
  });

  it("adopts the first id without clearing when the SPA has none baked in (dev)", () => {
    resetViewCacheBuildForTests("");
    writeViewCache("api:sources", []);
    expect(noteServerBuild("build-x")).toBe(false);
    expect(readViewCache("api:sources")).toEqual([]);
    expect(noteServerBuild("build-y")).toBe(true);
  });

  it("apiFetch reads X-Build-Id from every response", async () => {
    writeViewCache("api:job:1", { id: "1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("build-a")));
    await apiFetch("/api/jobs/1");
    expect(readViewCache("api:job:1")).toEqual({ id: "1" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("build-c")));
    await apiFetch("/api/jobs/1");
    expect(readViewCache("api:job:1")).toBeUndefined();
  });
});
