import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useSessionMock, refreshMock, replaceMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { OnboardingPage } from "./onboarding-page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com", aiConsentAt: null, onboardedAt: null },
        preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
        latestCv: null,
      },
      loading: false,
      error: null,
      refresh: refreshMock,
      signOut: vi.fn(),
    });
    refreshMock.mockReset();
    replaceMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("walks Welcome -> Your CV -> Keywords via Continue, and finishes onboarding", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/me/preferences" && method === "PUT") {
        return Promise.resolve(jsonResponse(200, { preferences: JSON.parse(init!.body as string) }));
      }
      if (url === "/api/me/onboarded" && method === "POST") {
        return Promise.resolve(jsonResponse(200, { onboardedAt: "2026-01-01T00:00:00Z" }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockResolvedValue(null);

    render(<OnboardingPage />);

    expect(screen.getByRole("heading", { name: "Let's set you up" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Upload your CV" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Confirm your keywords" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "python" } });
    fireEvent.keyDown(screen.getByLabelText("Keywords"), { key: "Enter" });
    expect(screen.getByText("python")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show my jobs" }));
    });

    const prefCall = fetchMock.mock.calls.find(([u]) => u === "/api/me/preferences");
    expect(prefCall).toBeTruthy();
    const onboardedCall = fetchMock.mock.calls.find(([u]) => u === "/api/me/onboarded");
    expect(onboardedCall).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("skip links advance steps without requiring input, and the last skip still finishes onboarding", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/me/onboarded" && method === "POST") {
        return Promise.resolve(jsonResponse(200, { onboardedAt: "2026-01-01T00:00:00Z" }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockResolvedValue(null);

    render(<OnboardingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByRole("heading", { name: "Upload your CV" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByRole("heading", { name: "Confirm your keywords" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    });

    // Skipping the last step still marks onboarding done, but never saves preferences.
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/me/preferences")).toBe(false);
    const onboardedCall = fetchMock.mock.calls.find(([u]) => u === "/api/me/onboarded");
    expect(onboardedCall).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith("/");
  });
});
