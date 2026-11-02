import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@ujc/ui";

const { useSessionMock, searchParamsMock, replaceMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  searchParamsMock: new URLSearchParams(),
  replaceMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({ replace: replaceMock }),
}));

import { Connections } from "./connections";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function platform(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "weworkremotely",
    label: "We Work Remotely",
    kind: "public",
    homepage: "https://weworkremotely.com",
    description: "Built in. Always on.",
    available: true,
    connected: false,
    ...overrides,
  };
}

const CATALOGUE = [
  platform({ id: "weworkremotely", label: "We Work Remotely" }),
  platform({
    id: "adzuna",
    label: "Adzuna",
    kind: "api_key",
    homepage: "https://www.adzuna.com",
    description: "Add your own key.",
  }),
  platform({
    id: "linkedin",
    label: "LinkedIn",
    kind: "runner",
    description: "Local runner — crawl with your own login via a companion runner on your machine.",
    available: true,
  }),
  platform({
    id: "glassdoor",
    label: "Glassdoor",
    kind: "runner",
    description: "Local runner — crawl with your own login via a companion runner on your machine.",
    available: true,
  }),
  platform({
    id: "upwork",
    label: "Upwork",
    kind: "oauth",
    homepage: "https://www.upwork.com",
    description: "Use the official MCP or connect for in-app search.",
    available: false,
  }),
];

function renderConnections() {
  return render(
    <ToastProvider>
      <Connections />
    </ToastProvider>,
  );
}

describe("Connections", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      me: { user: { id: "1", email: "person@example.com" } },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    for (const key of Array.from(searchParamsMock.keys())) searchParamsMock.delete(key);
    replaceMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the built-in, Adzuna, Upwork and runner cards from GET /api/platforms", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/platforms") return Promise.resolve(jsonResponse(200, { items: CATALOGUE }));
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderConnections();

    expect(await screen.findByText("We Work Remotely")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Adzuna" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Upwork" })).toBeTruthy();
    expect(screen.getByText(/mcp.upwork.com\/mcp/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Search on Upwork/ })).toBeTruthy();
    // Upwork not available: no in-app connect button.
    expect(screen.queryByText("Connect for in-app search")).toBeNull();
    expect(screen.getByText(/In-app search isn't enabled yet/)).toBeTruthy();
    // Runner platforms: local runner, linking to /account/#runner.
    expect(screen.getByRole("heading", { name: "Local runner" })).toBeTruthy();
    expect(screen.getByText(/LinkedIn and Glassdoor/)).toBeTruthy();
    const runnerLink = screen.getByRole("link", { name: "Set up a local runner" });
    // next.config.ts trailingSlash normalizes "/account/#runner" to this at render time.
    expect(runnerLink.getAttribute("href")).toBe("/account#runner");
  });

  it("connects Adzuna with the form and shows the connected state after reload", async () => {
    let connected = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/platforms") {
        const items = CATALOGUE.map((p) =>
          p.id === "adzuna" ? { ...p, connected, externalAccount: connected ? "my-app-id" : undefined } : p,
        );
        return Promise.resolve(jsonResponse(200, { items }));
      }
      if (url === "/api/connections/adzuna" && method === "PUT") {
        connected = true;
        return Promise.resolve(
          jsonResponse(200, {
            platform: "adzuna",
            connected: true,
            externalAccount: "my-app-id",
            maskedAppKey: "****-key",
          }),
        );
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderConnections();
    await screen.findByRole("heading", { name: "Adzuna" });

    fireEvent.change(screen.getByLabelText("App id"), { target: { value: "my-app-id" } });
    fireEvent.change(screen.getByLabelText("App key"), { target: { value: "super-secret-key" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });

    await waitFor(() => expect(screen.getByText("App id: my-app-id")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("shows a toast from ?upwork=connected and strips the query param", async () => {
    searchParamsMock.set("upwork", "connected");
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/platforms") return Promise.resolve(jsonResponse(200, { items: CATALOGUE }));
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderConnections();

    expect(await screen.findByText("Upwork connected")).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith("/connections/");
  });
});
