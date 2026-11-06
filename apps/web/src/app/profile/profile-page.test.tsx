import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@ujc/ui";
import type { MeResponse, UserProfile } from "@ujc/core";

const { useSessionMock, mutateMock } = vi.hoisted(() => ({ useSessionMock: vi.fn(), mutateMock: vi.fn() }));

vi.mock("@/lib/session", () => ({ useSession: () => useSessionMock() }));
vi.mock("@/lib/require-auth", () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => children }));

import { diffProfile, linkProblem, ProfilePage } from "./profile-page";

const PROFILE: UserProfile = {
  displayName: null,
  headline: null,
  links: { linkedin: null, github: null, website: null },
  candidateCountry: "VN",
  timeZone: "Asia/Ho_Chi_Minh",
  keywords: ["React"],
  remoteOnly: false,
};

const ME: MeResponse = {
  user: { id: "1", email: "linh@example.com", aiConsentAt: null, onboardedAt: null, role: "user" },
  preferences: { keywords: ["React"], remoteOnly: false, candidateCountry: "VN", digestTz: "Asia/Ho_Chi_Minh" },
  latestCv: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("linkProblem", () => {
  it("accepts empty and https URLs on the right host", () => {
    expect(linkProblem("", "github.com")).toBeNull();
    expect(linkProblem("https://github.com/linh", "github.com")).toBeNull();
    expect(linkProblem("https://www.linkedin.com/in/linh", "linkedin.com")).toBeNull();
    expect(linkProblem("https://linh.dev", null)).toBeNull();
  });

  it("rejects http, other schemes, credentials and the wrong host", () => {
    expect(linkProblem("http://linh.dev", null)).toBe("invalid");
    expect(linkProblem("javascript:alert(1)", null)).toBe("invalid");
    expect(linkProblem("https://a:b@linh.dev", null)).toBe("invalid");
    expect(linkProblem("linh.dev", null)).toBe("invalid");
    expect(linkProblem("https://github.com.evil.dev/x", "github.com")).toBe("wrongHost");
  });
});

describe("diffProfile", () => {
  it("returns only changed keys, links per key", () => {
    expect(diffProfile(PROFILE, PROFILE)).toEqual({});
    const next = { ...PROFILE, displayName: "Linh", links: { ...PROFILE.links, github: "https://github.com/l" } };
    expect(diffProfile(PROFILE, next)).toEqual({ displayName: "Linh", links: { github: "https://github.com/l" } });
  });
});

describe("ProfilePage", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    useSessionMock.mockReturnValue({ me: ME, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn(), mutate: mutateMock });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderPage() {
    return render(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    );
  }

  it("saves only what changed, optimistically, and confirms with a toast", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json(200, { profile: { ...PROFILE, displayName: "Linh Nguyen", headline: "Senior React developer" } })
        : json(200, { profile: PROFILE }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    const name = await screen.findByLabelText("Display name");
    fireEvent.change(name, { target: { value: "  Linh   Nguyen " } });
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Senior React developer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await screen.findByText("Profile saved");
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ displayName: "Linh Nguyen", headline: "Senior React developer" });
    // Optimistic update first, then the server's copy.
    expect(mutateMock).toHaveBeenCalledTimes(2);
    const optimistic = mutateMock.mock.calls[0][0](ME) as MeResponse;
    expect(optimistic.user.displayName).toBe("Linh Nguyen");
  });

  it("blocks an invalid link and reverts when the server refuses", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json(400, { error: { code: "validation_error", message: "Invalid input." } })
        : json(200, { profile: PROFILE }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    const github = await screen.findByLabelText("GitHub");
    fireEvent.change(github, { target: { value: "http://github.com/linh" } });
    expect(screen.getByText("Enter a full https:// address.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(github, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Linh" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Couldn't save your profile");
    await waitFor(() => expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(""));
    // Optimistic edit, then the rollback to the previous session value.
    expect(mutateMock).toHaveBeenCalledTimes(2);
    expect(mutateMock.mock.calls[1][0](ME)).toBe(ME);
  });
});
