import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: replaceMock }),
}));

import { SessionProvider, useSession } from "./session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Probe() {
  const { me, loading } = useSession();
  return <p>{loading ? "loading" : me ? "signed-in" : "signed-out"}</p>;
}

describe("SessionProvider's global 401 handler", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pathname = "/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("does not redirect to /login when the initial GET /api/me 401s on the public home page", async () => {
    pathname = "/";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("signed-out")).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect to /login on the public job detail page either", async () => {
    pathname = "/jobs/view";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("signed-out")).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("still redirects to /login when a protected route's initial check 401s", async () => {
    pathname = "/tracker/";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: { code: "unauthorized", message: "Sign in required" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByText("signed-out")).toBeTruthy());
    expect(replaceMock).toHaveBeenCalledWith(expect.stringContaining("/login/?next="));
  });
});
