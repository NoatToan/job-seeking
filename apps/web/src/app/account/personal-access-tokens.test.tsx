import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@ujc/ui";
import { PersonalAccessTokens } from "./personal-access-tokens";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function token(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "1",
    name: "My laptop",
    scopes: ["jobs:read"],
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function renderTokens() {
  return render(
    <ToastProvider>
      <PersonalAccessTokens />
    </ToastProvider>,
  );
}

describe("PersonalAccessTokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows an empty state when there are no tokens", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/tokens") return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();

    expect(await screen.findByText("No tokens yet.")).toBeTruthy();
  });

  it("lists existing tokens with their scopes", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/tokens") {
        return Promise.resolve(
          jsonResponse(200, { items: [token({ scopes: ["jobs:read", "applications:write"] })] }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();

    expect(await screen.findByText("My laptop")).toBeTruthy();
    expect(screen.getByText("jobs:read")).toBeTruthy();
    expect(screen.getByText("applications:write")).toBeTruthy();
  });

  it("creates a token and shows the raw value exactly once", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/tokens" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      if (url === "/api/tokens" && method === "POST") {
        const body = JSON.parse(init?.body as string);
        expect(body).toEqual({ name: "CI box", scopes: ["jobs:read"], expiresInDays: 365 });
        return Promise.resolve(
          jsonResponse(201, { ...token({ name: "CI box" }), token: "ujc_pat_abc123" }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();
    await screen.findByText("No tokens yet.");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI box" } });
    fireEvent.click(screen.getByRole("switch", { name: "Read jobs" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    });

    expect(await screen.findByText("ujc_pat_abc123")).toBeTruthy();
    expect(screen.getByText(/won't be shown again/)).toBeTruthy();
    expect(screen.getByText("CI box")).toBeTruthy();
  });

  it("requires a name and at least one scope before calling the API", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/tokens" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();
    await screen.findByText("No tokens yet.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    });

    expect(screen.getByRole("alert").textContent).toMatch(/name/i);
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(
      false,
    );
  });

  it("revokes a token", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/tokens" && method === "GET") {
        return Promise.resolve(jsonResponse(200, { items: [token()] }));
      }
      if (url === "/api/tokens/1" && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderTokens();
    await screen.findByText("My laptop");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    });

    expect(await screen.findByText("Revoked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
});
