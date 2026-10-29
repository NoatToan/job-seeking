import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchParamsMock = new URLSearchParams();
const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock,
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    me: null,
    loading: false,
    error: null,
    refresh: refreshMock,
    signOut: vi.fn(),
  }),
}));

import { LoginForm } from "./login-form";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("LoginForm", () => {
  beforeEach(() => {
    for (const key of Array.from(searchParamsMock.keys())) searchParamsMock.delete(key);
    replaceMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("moves to the code step after requesting an OTP and shows the review-mode devCode banner", async () => {
    const fetchMock = vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- keeps `.mock.calls[0]` typed as [url, init]
      (url: string, init?: RequestInit) => {
        if (url === "/api/auth/otp") {
          return Promise.resolve(
            jsonResponse(202, { sent: true, expiresInSec: 600, devCode: "123456" }),
          );
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(
      () => expect(screen.getByRole("group", { name: "6-digit code" })).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(screen.getByText(/Review mode code: 123456/)).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/otp");
    expect(JSON.parse(init.body as string)).toEqual({ email: "person@example.com" });
  });

  it("shows a friendly error and does not sign in when the code is invalid", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/otp") {
        return Promise.resolve(jsonResponse(202, { sent: true, expiresInSec: 600 }));
      }
      if (url === "/api/auth/verify") {
        return Promise.resolve(
          jsonResponse(400, { error: { code: "invalid_code", message: "Nope" } }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(
      () => expect(screen.getByRole("group", { name: "6-digit code" })).toBeTruthy(),
      { timeout: 5000 },
    );

    // No devCode banner this time (production-like response).
    expect(screen.queryByText(/Review mode code/)).toBeNull();

    for (let i = 0; i < 6; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), {
        target: { value: String(i) },
      });
    }

    await waitFor(
      () => expect(screen.getByRole("alert").textContent).toContain("isn't right"),
      { timeout: 5000 },
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("redirects to /cv/ after a correct code when the user has no CV yet", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/auth/otp") {
        return Promise.resolve(jsonResponse(202, { sent: true, expiresInSec: 600 }));
      }
      if (url === "/api/auth/verify") {
        return Promise.resolve(jsonResponse(200, { user: { id: "1", email: "person@example.com" } }));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockResolvedValue({
      user: { id: "1", email: "person@example.com" },
      preferences: { keywords: [], remoteOnly: false, candidateCountry: null },
      latestCv: null,
    });

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(
      () => expect(screen.getByRole("group", { name: "6-digit code" })).toBeTruthy(),
      { timeout: 5000 },
    );

    for (let i = 0; i < 6; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), {
        target: { value: String(i) },
      });
    }

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/cv/"), { timeout: 5000 });
  });
});
