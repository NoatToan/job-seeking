import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { countryForZone, remoteAccess } from "@ujc/core";
import { RemoteAccessBadge } from "../index";

afterEach(cleanup);

describe("remoteAccess", () => {
  it("classifies worldwide, region-locked and unstated jobs", () => {
    expect(remoteAccess(["WORLDWIDE"], "VN")).toEqual({ scope: "worldwide", places: [], acceptsCandidate: true });
    expect(remoteAccess(["APAC"], "VN")).toEqual({ scope: "restricted", places: ["APAC"], acceptsCandidate: true });
    expect(remoteAccess(["US", "CA"], "VN")).toEqual({ scope: "restricted", places: ["US", "CA"], acceptsCandidate: false });
    expect(remoteAccess(null, "VN")).toEqual({ scope: "unknown", places: [], acceptsCandidate: null });
    expect(remoteAccess(["US"], null).acceptsCandidate).toBeNull();
  });

  it("lists countries before regions", () => {
    expect(remoteAccess(["EUROPE", "GB"]).places).toEqual(["GB", "EUROPE"]);
  });

  it("guesses the country from the time zone", () => {
    expect(countryForZone("Asia/Ho_Chi_Minh")).toBe("VN");
    expect(countryForZone("Australia/Sydney")).toBe("AU");
    expect(countryForZone("Europe/Kyiv")).toBeNull();
  });
});

describe("RemoteAccessBadge", () => {
  it("says who can apply and whether that includes the candidate", () => {
    const { rerender } = render(<RemoteAccessBadge openTo={["US"]} basedIn="VN" />);
    expect(screen.getByText("Remote · 🇺🇸 US only")).toBeTruthy();
    expect(screen.getByText(/Not open to candidates in Vietnam/)).toBeTruthy();

    rerender(<RemoteAccessBadge openTo={["WORLDWIDE"]} basedIn="VN" />);
    expect(screen.getByText("Remote · Worldwide")).toBeTruthy();
    expect(screen.getByText(/Open to candidates in Vietnam/)).toBeTruthy();

    rerender(<RemoteAccessBadge openTo={null} basedIn="VN" />);
    expect(screen.getByText("Remote · region not stated")).toBeTruthy();
  });
});
