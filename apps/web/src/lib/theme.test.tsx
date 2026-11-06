import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readTheme, THEME_COLORS, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-core";
import { setTheme, ThemePicker, ThemeToggle } from "./theme";

const root = document.documentElement;

function addThemeMetas() {
  for (const scheme of ["light", "dark"]) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    document.head.appendChild(meta);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  root.classList.remove("dark", "light");
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});

describe("theme setting", () => {
  it("defaults to system: no class on <html>, nothing stored", () => {
    expect(readTheme()).toBe("system");
    applyTheme("system");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.classList.contains("light")).toBe(false);
  });

  it("persists the choice and puts the matching class on <html>", () => {
    act(() => setTheme("dark"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readTheme()).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);

    act(() => setTheme("light"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(root.classList.contains("light")).toBe(true);
    expect(root.classList.contains("dark")).toBe(false);

    act(() => setTheme("system"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(root.className).not.toMatch(/\b(dark|light)\b/);
  });

  it("ignores garbage in storage and survives storage throwing", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readTheme()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
  });

  it("points both theme-color metas at a forced palette and restores them for system", () => {
    addThemeMetas();
    const [light, dark] = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    applyTheme("dark");
    expect([light.content, dark.content]).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
    applyTheme("system");
    expect([light.content, dark.content]).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it("the pre-paint script applies a saved choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("the top-bar toggle cycles System → Light → Dark with an accessible name", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /Appearance: System\. Switch to Light/ }));
    expect(root.classList.contains("light")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Appearance: Light\. Switch to Dark/ }));
    expect(root.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: /Appearance: Dark\. Switch to System/ })).toBeTruthy();
  });

  it("the account-sheet picker selects a preference", () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(root.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });
});
