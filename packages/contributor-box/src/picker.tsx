"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cssSelectorFor, describeElement, isWidgetNode, WIDGET_ATTR } from "./selector";
import type { Region } from "./types";
import { Button } from "./ui";

export interface PickResult {
  /** Set when an element was clicked; `null` for a dragged area. */
  selector: string | null;
  text: string | null;
  /** Viewport CSS pixels. */
  region: Region;
}

// Fingers wobble more than mice: a tap must not turn into an area selection.
const DRAG_THRESHOLD = { mouse: 8, pen: 8, touch: 16 } as const;

/** Elements a keyboard user can step through with Tab (in document order). */
const KEYBOARD_CANDIDATES =
  "a[href], button, input, select, textarea, [tabindex], [role], h1, h2, h3, h4, img, label, li, p, td, th";

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

function pickOf(el: Element): PickResult {
  return {
    selector: cssSelectorFor(el),
    text: describeElement(el) || null,
    region: clipToViewport(el.getBoundingClientRect()),
  };
}

function clipToViewport(r: { left: number; top: number; width: number; height: number }): Region {
  const x = Math.max(0, Math.round(r.left));
  const y = Math.max(0, Math.round(r.top));
  const right = Math.min(window.innerWidth, Math.round(r.left + r.width));
  const bottom = Math.min(window.innerHeight, Math.round(r.top + r.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** The page element under the pointer, ignoring the picker overlay and the widget itself. */
export function elementAt(x: number, y: number): Element | null {
  const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
  return stack.find((el) => !isWidgetNode(el) && el !== document.documentElement && el !== document.body) ?? null;
}

/**
 * Full-screen overlay: hover highlights the element under the pointer; click picks it; drag
 * selects a rectangle. Esc (or the Cancel button) cancels. Works with mouse, pen and touch.
 */
export function ElementPicker({
  hint,
  cancelLabel,
  onPick,
  onCancel,
}: {
  hint: string;
  cancelLabel: string;
  onPick: (result: PickResult) => void;
  onCancel: () => void;
}) {
  const [hover, setHover] = useState<Region | null>(null);
  const [drag, setDrag] = useState<Region | null>(null);
  const [current, setCurrent] = useState<Element | null>(null);
  const start = useRef<{ x: number; y: number; type: keyof typeof DRAG_THRESHOLD } | null>(null);
  const cancelRef = useRef(onCancel);
  const pickRef = useRef(onPick);
  const currentRef = useRef<Element | null>(null);

  useEffect(() => {
    cancelRef.current = onCancel;
    pickRef.current = onPick;
  }, [onCancel, onPick]);

  // Keyboard alternative to the pointer: Tab / Shift+Tab step through visible page elements,
  // Arrow Up widens to the parent, Enter picks, Esc cancels.
  useEffect(() => {
    const select = (el: Element | null) => {
      currentRef.current = el;
      setCurrent(el);
      if (el) {
        el.scrollIntoView?.({ block: "nearest" });
        setHover(clipToViewport(el.getBoundingClientRect()));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const all = Array.from(document.querySelectorAll(KEYBOARD_CANDIDATES)).filter(
          (el) => !isWidgetNode(el) && isVisible(el),
        );
        if (all.length === 0) return;
        const i = currentRef.current ? all.indexOf(currentRef.current) : -1;
        const next = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : (i + 1) % all.length;
        select(all[next]);
      } else if (e.key === "ArrowUp" && currentRef.current) {
        e.preventDefault();
        const parent = currentRef.current.parentElement;
        if (parent && parent !== document.body && parent !== document.documentElement) select(parent);
      } else if (e.key === "Enter" && currentRef.current) {
        e.preventDefault();
        pickRef.current(pickOf(currentRef.current));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onPointerMove = (e: ReactPointerEvent) => {
    if (start.current) {
      const s = start.current;
      const threshold = DRAG_THRESHOLD[s.type];
      if (Math.abs(e.clientX - s.x) > threshold || Math.abs(e.clientY - s.y) > threshold) {
        setDrag(
          clipToViewport({
            left: Math.min(s.x, e.clientX),
            top: Math.min(s.y, e.clientY),
            width: Math.abs(e.clientX - s.x),
            height: Math.abs(e.clientY - s.y),
          }),
        );
      }
      return;
    }
    const el = elementAt(e.clientX, e.clientY);
    setHover(el ? clipToViewport(el.getBoundingClientRect()) : null);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const type = e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse";
    start.current = { x: e.clientX, y: e.clientY, type };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (drag) {
      onPick({ selector: null, text: null, region: drag });
      return;
    }
    const el = elementAt(e.clientX, e.clientY);
    if (!el) return;
    onPick(pickOf(el));
  };

  const box = drag ?? hover;
  return createPortal(
    <div
      {...{ [WIDGET_ATTR]: "" }}
      data-testid="contrib-picker"
      className="fixed inset-0 z-[2147483000] cursor-crosshair touch-none"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-control-sm border-2 border-tint bg-tint/10"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      ) : null}
      <div
        role="status"
        className="pointer-events-auto fixed top-3 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-card bg-label px-4 py-2 text-footnote text-background shadow-overlay"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <span>
          {hint}
          {current ? <span className="block font-semibold">{describeElement(current, 60) || cssSelectorFor(current)}</span> : null}
        </span>
        <Button size="sm" variant="gray" onClick={onCancel} className="bg-background/20 text-background">
          {cancelLabel}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
