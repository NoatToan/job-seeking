import { afterEach, describe, expect, it, vi } from "vitest";
import { detectLanguage, LANGUAGE_COOKIE, saveLanguage } from "./index";

function clearCookie() {
  document.cookie = `${LANGUAGE_COOKIE}=; path=/; max-age=0`;
}

describe("detectLanguage", () => {
  afterEach(() => {
    clearCookie();
    vi.restoreAllMocks();
  });

  it("follows the browser language when nothing was picked", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["vi-VN", "en-US"]);
    expect(detectLanguage()).toBe("vi");
  });

  it("falls back to English for unsupported browser languages", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    expect(detectLanguage()).toBe("en");
  });

  it("prefers the saved choice over the browser", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["vi-VN"]);
    saveLanguage("en");
    expect(detectLanguage()).toBe("en");
  });
});
