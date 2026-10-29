"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx";
import { XIcon } from "../icons";
import { IconButton } from "./button";

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky action area (e.g. Cancel + primary Button). */
  footer?: ReactNode;
  /** Accessible name of the close button. Default "Close". */
  closeLabel?: string;
  /** "sheet" = bottom sheet on phones, centred card on >= sm. "alert" = always centred and narrow. */
  variant?: "sheet" | "alert";
  className?: string;
}

/**
 * Modal sheet / dialog. role=dialog + aria-modal, focus moves inside on open and is trapped,
 * Esc and the scrim close it, focus returns to the opener on close, page scroll is locked.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
  variant = "sheet",
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(`[data-autofocus], ${FOCUSABLE}`);
    (first ?? panel)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || active === panel)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      } else if (!panel.contains(active)) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const isAlert = variant === "alert";
  return createPortal(
    <div className={cx("fixed inset-0 z-50 flex justify-center", isAlert ? "items-center p-6" : "items-end sm:items-center sm:p-6")}>
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        role={isAlert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[90dvh] w-full flex-col overflow-hidden bg-grouped shadow-overlay focus:outline-none",
          isAlert
            ? "max-w-sm animate-pop-in rounded-sheet"
            : "animate-sheet-up rounded-t-sheet sm:max-w-lg sm:animate-pop-in sm:rounded-sheet",
          className,
        )}
      >
        {!isAlert ? (
          <span aria-hidden className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-fill sm:hidden" />
        ) : null}
        <header className={cx("flex items-start gap-3 px-5 pt-4", isAlert && "text-center")}>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-headline text-label">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-subheadline text-label-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {!isAlert ? (
            <IconButton
              label={closeLabel}
              icon={<XIcon size={16} strokeWidth={2.5} />}
              variant="gray"
              size="sm"
              onClick={onClose}
            />
          ) : null}
        </header>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : <div className="h-4" />}
        {footer ? (
          <footer className="flex flex-col-reverse gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
