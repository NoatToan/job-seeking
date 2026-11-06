import { useSyncExternalStore } from "react";

/** Below `md` (768px): the phone shell (tab bar, one column, sheets instead of popovers —
 * DESIGN_SYSTEM §5.1). */
const PHONE_QUERY = "(max-width: 767.98px)";

function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * `true` on phone widths. `false` on the server (static prerender) and wherever `matchMedia` is
 * missing, so the desktop layout is the default and phones switch to their own pattern — one tree
 * rendered at a time, never both hidden with CSS (they would duplicate labelled controls).
 */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}
