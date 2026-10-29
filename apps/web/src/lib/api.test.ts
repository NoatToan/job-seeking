import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, getJob, getJobs, getSources, setUnauthorizedHandler } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    clearCookies();
    setUnauthorizedHandler(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not add the CSRF header on a GET request", async () => {
    document.cookie = "ujc_csrf=secret-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/jobs");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it("adds the CSRF header from the ujc_csrf cookie on unsafe methods only", async () => {
    document.cookie = "ujc_csrf=secret-token";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/profiles", { method: "POST", body: { name: "x" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("secret-token");
    expect(init.credentials).toBe("include");
  });

  it("maps a non-2xx error body to ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(404, {
        error: { code: "not_found", message: "Job not found", fields: { id: "bad" } },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/api/jobs/999")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "not_found",
      message: "Job not found",
      fields: { id: "bad" },
    });
  });

  it("is an instance of ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: { code: "bad_request", message: "nope" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await apiFetch("/api/jobs").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("calls the registered 401 handler", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Please sign in" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/auth/me").catch(() => {});

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not call the 401 handler on a successful request", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/jobs");

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("typed wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getJobs calls GET /api/jobs with query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 20 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJobs({ q: "react", remote: true, page: 2 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/jobs?");
    expect(url).toContain("q=react");
    expect(url).toContain("remote=true");
    expect(url).toContain("page=2");
  });

  it("getJob calls GET /api/jobs/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { id: "7", description: "text" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getJob("7");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/jobs/7");
  });

  it("getSources calls GET /api/sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await getSources();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/sources");
  });
});

describe("NEXT_PUBLIC_API_BASE_URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefixes requests with the configured API base URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:8000");
    vi.resetModules();
    const { getJobs: getJobsWithBase, getSources: getSourcesWithBase } = await import("./api");

    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { items: [], total: 0, page: 1, pageSize: 20 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getJobsWithBase({ q: "react" });
    await getSourcesWithBase();

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toBe("http://localhost:8000/api/jobs?q=react");
    expect(urls[1]).toBe("http://localhost:8000/api/sources");
  });
});
