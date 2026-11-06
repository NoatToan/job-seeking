import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/**
 * Collapse state for the home hero's headline (title, tagline, sources). The search and filters
 * stay visible; only the headline gets out of the way so more jobs fit on screen.
 *
 * - **Auto**: scrolling a job list down (any scroller marked `data-collapses-hero`, or the window)
 *   folds the headline; scrolling back to the top unfolds it. Resting the mouse on the hero for a
 *   moment peeks it open, and it folds again shortly after the pointer leaves.
 * - **Pinned**: the toggle button folds it on purpose. That choice is remembered in this browser
 *   and wins over hover; pressing the toggle again unpins it.
 */

const STORAGE_KEY = "ujc:hero-collapsed";
/** Scrolled past the headline's own height, so folding it can't scroll the page back to 0. */
const COLLAPSE_AFTER_PX = 160;
const EXPAND_AT_PX = 8;
const PEEK_OPEN_MS = 300;
const PEEK_CLOSE_MS = 350;

const listeners = new Set<() => void>();

function readPinned(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePinned(pinned: boolean): void {
  try {
    if (pinned) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the choice just lasts for this page.
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function useHeroCollapse(rootRef: RefObject<HTMLElement | null>) {
  const pinned = useSyncExternalStore(subscribe, readPinned, () => false);
  const [scrolled, setScrolled] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const lastTop = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : (e.target as Element | null);
      if (!el || (el !== document.scrollingElement && !el.hasAttribute("data-collapses-hero"))) return;
      const top = el.scrollTop;
      const prev = lastTop.get(el) ?? 0;
      lastTop.set(el, top);
      if (top <= EXPAND_AT_PX) setScrolled(false);
      else if (top > COLLAPSE_AFTER_PX && top > prev) {
        setScrolled(true);
        setPeek(false);
      }
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      clearTimeout(timer.current);
    };
  }, []);

  const onPointerEnter = useCallback((e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(true), PEEK_OPEN_MS);
  }, []);

  const onPointerLeave = useCallback(() => {
    clearTimeout(timer.current);
    const close = () => {
      // Keep it open while the user is typing or picking in it (focus inside), or while a popover
      // opened from it (sources list, a filter panel) is open; those are portaled outside the hero.
      const root = rootRef.current;
      if (root?.querySelector('[data-hero-headline] [aria-expanded="true"]') || root?.contains(document.activeElement)) {
        timer.current = setTimeout(close, PEEK_CLOSE_MS);
      } else setPeek(false);
    };
    timer.current = setTimeout(close, PEEK_CLOSE_MS);
  }, [rootRef]);

  const collapsed = pinned || (scrolled && !peek);

  const toggle = useCallback(() => {
    clearTimeout(timer.current);
    setPeek(false);
    if (collapsed) {
      writePinned(false);
      setScrolled(false);
    } else writePinned(true);
  }, [collapsed]);

  return { collapsed, toggle, onPointerEnter, onPointerLeave };
}
