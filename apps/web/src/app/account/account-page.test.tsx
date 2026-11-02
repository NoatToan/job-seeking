import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@ujc/ui";

const { useSessionMock, signOutMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

import { AccountPage } from "./account-page";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AccountPage", () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({
      me: {
        user: { id: "1", email: "person@example.com", aiConsentAt: "2026-01-01T00:00:00Z", onboardedAt: "2026-01-01T00:00:00Z" },
        preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
        latestCv: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      signOut: signOutMock,
    });
    signOutMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  it("keeps the delete button disabled until DELETE is typed, then deletes and signs out", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/me" && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`unexpected request ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <AccountPage />
      </ToastProvider>,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "nope" },
    });
    expect(deleteButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    expect(deleteButton.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(deleteButton);
    });

    const deleteCall = fetchMock.mock.calls.find(([u, i]) => {
      const init = i as RequestInit | undefined;
      return u === "/api/me" && (init?.method ?? "GET").toUpperCase() === "DELETE";
    });
    expect(deleteCall).toBeTruthy();
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("downloads an export via a Blob fetch", async () => {
    const createObjectURLSpy = vi.fn(() => "blob:fake-url");
    const revokeObjectURLSpy = vi.fn();
    // jsdom doesn't implement these; the component calls them to trigger a browser download.
    URL.createObjectURL = createObjectURLSpy;
    URL.revokeObjectURL = revokeObjectURLSpy;

    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/me/export") {
        return Promise.resolve(jsonResponse(200, { user: { email: "person@example.com" } }));
      }
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ToastProvider>
        <AccountPage />
      </ToastProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/me/export", expect.anything());
    expect(createObjectURLSpy).toHaveBeenCalled();
  });
});
