import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalyticsCookies,
  CONSENT_COOKIE,
  CONSENT_INIT_SCRIPT,
  CONSENT_VERSION,
  isAnalyticsCookie,
  parseConsent,
  readConsent,
  writeConsent,
} from "./consent-core";
import { CookieConsent, CookieSettingsButton } from "./consent";

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: ({ gtmId }: { gtmId: string }) => <div data-testid="gtm">{gtmId}</div>,
}));

type W = Window & { dataLayer?: unknown[]; gtag?: unknown };

function clearCookies() {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  clearCookies();
  delete (window as W).dataLayer;
  delete (window as W).gtag;
});

afterEach(() => {
  cleanup();
  clearCookies();
});

describe("consent record", () => {
  it("round-trips through the cookie", () => {
    expect(readConsent()).toBeNull();
    writeConsent(true, 1_700_000_000_000);
    expect(readConsent()).toEqual({ analytics: true, at: 1_700_000_000 });
    writeConsent(false);
    expect(readConsent()?.analytics).toBe(false);
  });

  it("ignores malformed values and records from another version", () => {
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent(`v${CONSENT_VERSION + 1}.a1.1`)).toBeNull();
    expect(parseConsent(`v${CONSENT_VERSION}.a2.1`)).toBeNull();
  });

  it("recognises Google Analytics cookies only", () => {
    expect(["_ga", "_gid", "_ga_ABC123", "_gat_UA-1"].every(isAnalyticsCookie)).toBe(true);
    expect(["ujc_session", "ujc_consent", "_gaming"].some(isAnalyticsCookie)).toBe(false);
  });

  it("deletes analytics cookies and keeps the rest", () => {
    document.cookie = "_ga=GA1.1.1; path=/";
    document.cookie = "_ga_XYZ=GS1.1; path=/";
    document.cookie = "ujc_locale=vi; path=/";
    clearAnalyticsCookies();
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toMatch(/ujc_locale=vi/);
  });
});

describe("CONSENT_INIT_SCRIPT", () => {
  const run = () => new Function(CONSENT_INIT_SCRIPT)();
  const calls = () => ((window as W).dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

  it("defaults every signal to denied", () => {
    run();
    expect(calls()).toEqual([
      ["consent", "default", expect.objectContaining({ analytics_storage: "denied", ad_storage: "denied" })],
    ]);
  });

  it("re-grants analytics for a visitor who accepted", () => {
    writeConsent(true);
    run();
    expect(calls()[1]).toEqual(["consent", "update", expect.objectContaining({ analytics_storage: "granted", ad_storage: "denied" })]);
  });

  it("stays denied for a visitor who rejected", () => {
    writeConsent(false);
    run();
    expect(calls()).toHaveLength(1);
  });
});

describe("CookieConsent", () => {
  it("asks on the first visit without loading GTM, and Reject is as prominent as Accept", () => {
    render(<CookieConsent gtmId="GTM-TEST" />);
    expect(screen.getByRole("region", { name: "Cookies on JobSeeking" })).toBeTruthy();
    expect(screen.queryByTestId("gtm")).toBeNull();
    const reject = screen.getByRole("button", { name: "Reject all" });
    const accept = screen.getByRole("button", { name: "Accept all" });
    expect(reject.className).toBe(accept.className);
  });

  it("Accept all saves the choice, loads GTM and grants analytics", () => {
    render(<CookieConsent gtmId="GTM-TEST" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
    expect(readConsent()?.analytics).toBe(true);
    expect(screen.getByTestId("gtm").textContent).toBe("GTM-TEST");
    expect(screen.queryByRole("region")).toBeNull();
    const last = (window as W).dataLayer?.at(-1) as unknown[];
    expect(Array.from(last)).toEqual(["consent", "update", expect.objectContaining({ analytics_storage: "granted" })]);
  });

  it("Reject all saves the choice and never loads GTM", () => {
    render(<CookieConsent gtmId="GTM-TEST" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(readConsent()?.analytics).toBe(false);
    expect(screen.queryByTestId("gtm")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("Customize: analytics starts off; saving without turning it on rejects", () => {
    render(<CookieConsent gtmId="GTM-TEST" />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    const toggle = screen.getByRole("switch", { name: "Analytics" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(readConsent()?.analytics).toBe(false);
  });

  it("does not ask again once chosen; Cookie settings reopens it and allows withdrawal", () => {
    writeConsent(true);
    document.cookie = "_ga=GA1.1.1; path=/";
    render(
      <>
        <CookieConsent gtmId="GTM-TEST" />
        <CookieSettingsButton />
      </>,
    );
    expect(screen.queryByRole("region")).toBeNull();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Cookie settings" })));
    const toggle = screen.getByRole("switch", { name: "Analytics" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));
    expect(readConsent()?.analytics).toBe(false);
    expect(document.cookie).not.toMatch(/_ga=/);
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=`);
  });
});
