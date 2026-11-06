"use client";

import { useLayoutEffect, useState } from "react";
import type { ReactNode, Ref, RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";

const GAP = 8;
const MARGIN = 8;

/**
 * A dropdown / popover panel anchored to a trigger, rendered in a portal on `document.body`.
 *
 * Why a portal: a panel drawn inline (`absolute z-50`) only competes inside its parent's stacking
 * context. Any ancestor with `position` + `z-index`, `transform`, `filter`, `backdrop-filter`,
 * `overflow` clipping or `contain` traps it, and content later in the page (a sticky list, a card
 * with `z-10`) paints over it — the time-zone picker opening *behind* the job list was exactly that.
 * From `body` with `position: fixed` and the top `z-popover` layer, nothing on the page can cover it.
 *
 * Opens below the anchor; flips above when there is not enough room below. Re-measures on scroll
 * (any scroller) and resize while open. `align="end"` lines the panel's right edge up with the anchor.
 */
export function FloatingPanel({
  anchorRef,
  open,
  children,
  className,
  align = "start",
  panelRef,
  ...rest
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  className?: string;
  align?: "start" | "end";
  panelRef?: Ref<HTMLDivElement>;
  id?: string;
  role?: string;
  "aria-label"?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; above: boolean } | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const width = panel?.offsetWidth ?? 0;
      const height = panel?.scrollHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = vh - a.bottom - GAP - MARGIN;
      const aboveRoom = a.top - GAP - MARGIN;
      const above = height > below && aboveRoom > below;
      let left = align === "end" ? a.right - width : a.left;
      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
      setPos({
        top: above ? a.top - GAP : a.bottom + GAP,
        left,
        maxHeight: Math.max(160, above ? aboveRoom : below),
        above,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [open, anchorRef, align, panel]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      {...rest}
      ref={(el) => {
        setPanel(el);
        if (typeof panelRef === "function") panelRef(el);
        else if (panelRef) panelRef.current = el;
      }}
      style={
        pos
          ? {
              top: pos.top,
              left: pos.left,
              maxHeight: pos.maxHeight,
              transform: pos.above ? "translateY(-100%)" : undefined,
            }
          : { top: 0, left: 0, visibility: "hidden" }
      }
      className={cx("fixed z-popover overflow-y-auto overscroll-contain animate-pop-in", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
