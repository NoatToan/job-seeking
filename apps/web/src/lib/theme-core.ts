/**
 * Appearance setting: follow the OS ("system"), or force light / dark. theme.css does the
 * colouring: `<html class="dark">` forces the dark palette, `<html class="light">` forces the
 * light one, neither = `prefers-color-scheme`. The choice lives in localStorage and is applied
 * before first paint by `THEME_INIT_SCRIPT` (inlined in the root layout), so there is no flash.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "ujc:theme";
export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Browser chrome colour per palette: the page background (`bg-grouped`) in each. */
export const THEME_COLORS = { light: "#f4f2ef", dark: "#0e0d0c" } as const;

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** Saved preference, "system" when nothing (valid) is saved or storage is unavailable. */
export function readTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** Puts the class for `pref` on `<html>` and points `<meta name="theme-color">` at it. */
export function applyTheme(pref: ThemePreference, root: HTMLElement = document.documentElement): void {
  root.classList.toggle("dark", pref === "dark");
  root.classList.toggle("light", pref === "light");
  // Next renders one theme-color meta per `prefers-color-scheme`; a forced palette overrides both.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute("media") ?? "";
    const systemColor = media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.content = pref === "system" ? systemColor : THEME_COLORS[pref];
  }
}

/**
 * Runs in `<head>` before the body paints. Kept tiny and dependency-free (it is a string); must
 * stay in step with `readTheme` / `applyTheme`. The metas are fixed up again on mount.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}})()`;

