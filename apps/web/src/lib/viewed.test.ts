import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The API module is already loaded by the test setup, so stub `fetch` (not `./api`).
const getViewedJobs = vi.fn();
const markJobsViewed = vi.fn();
const clearViewedJobs = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/me/viewed") && (!init?.method || init.method === "GET")) {
        return json(await getViewedJobs());
      }
      if (url.endsWith("/api/me/viewed") && init?.method === "POST") {
        return json(await markJobsViewed(JSON.parse(String(init.body)).jobIds));
      }
      if (url.endsWith("/api/me/viewed") && init?.method === "DELETE") {
        await clearViewedJobs();
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    }),
  );
});

import { clearViewed, markViewed, setViewedSignedIn, syncViewed, useViewedJobs } from "./viewed";

describe("read jobs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("signed out: remembers reads in this browser only", () => {
    const { result } = renderHook(() => useViewedJobs());
    act(() => markViewed("7"));
    expect(result.current.has("7")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("ujc:viewed") ?? "[]")).toEqual(["7"]);
    expect(markJobsViewed).not.toHaveBeenCalled();
  });

  it("on sign-in merges the account's history and pushes what was read here", async () => {
    markViewed("1");
    markViewed("2");
    getViewedJobs.mockResolvedValue({ jobIds: ["9", "2"] });
    markJobsViewed.mockResolvedValue({ saved: 1 });
    setViewedSignedIn(true);
    await act(async () => {
      await syncViewed();
    });
    const { result } = renderHook(() => useViewedJobs());
    expect([...result.current].sort()).toEqual(["1", "2", "9"]);
    expect(markJobsViewed).toHaveBeenCalledWith(["1"]);
  });

  it("signed in: batches new reads to the server", async () => {
    vi.useFakeTimers();
    markJobsViewed.mockResolvedValue({ saved: 2 });
    setViewedSignedIn(true);
    markViewed("3");
    markViewed("4");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(markJobsViewed).toHaveBeenCalledTimes(1);
    expect(markJobsViewed).toHaveBeenCalledWith(["3", "4"]);
  });

  it("clear forgets locally and on the account", async () => {
    clearViewedJobs.mockResolvedValue(undefined);
    setViewedSignedIn(true);
    markViewed("5");
    await clearViewed();
    const { result } = renderHook(() => useViewedJobs());
    expect(result.current.size).toBe(0);
    expect(clearViewedJobs).toHaveBeenCalled();
  });
});
