"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { Sheet } from "./sheet";
import type { SheetProps } from "./sheet";

/** Verbs a parent may call on a `ModalView` through its ref. */
export interface ModalViewHandle {
  /** Open the view. Runs `onOpen` first (reset a draft there). */
  open: () => void;
  /**
   * Close the view. `then` runs once it is closed and its history entry is gone — write URL state
   * there, not before, or popping the entry would undo the write.
   */
  close: (then?: () => void) => void;
}

export interface ModalViewProps extends Omit<SheetProps, "open" | "onClose" | "onEscape"> {
  /** React 19 ref prop: `useRef<ModalViewHandle>(null)`, then `ref.current?.open()`. */
  ref?: Ref<ModalViewHandle>;
  /** Runs on every `open()`, before the view shows. */
  onOpen?: () => void;
  /** The user dismissed it (close button, scrim, Esc, system Back) — discard drafts here. */
  onDismiss?: () => void;
  /** Set while a sub-step is shown: Esc and the system Back gesture call it instead of closing. */
  onBack?: () => void;
}

/**
 * Self-owned modal view for phones (DESIGN_SYSTEM §5.1): a `Sheet` that keeps its own open state and
 * is opened through an imperative handle, so the page behind never re-renders to show it. It pushes
 * one history entry while open, so the phone's Back gesture closes it (or steps back out of a
 * sub-step) instead of leaving the page.
 */
export function ModalView({ ref, onOpen, onDismiss, onBack, ...sheet }: ModalViewProps) {
  const [open, setOpen] = useState(false);
  const entryId = useId();
  /** Our history entry is the current one. */
  const pushed = useRef(false);
  const after = useRef<(() => void) | null>(null);
  const latest = useRef({ onOpen, onDismiss, onBack });
  useEffect(() => {
    latest.current = { onOpen, onDismiss, onBack };
  });

  const finish = useCallback(() => {
    setOpen(false);
    const then = after.current;
    after.current = null;
    then?.();
  }, []);

  const close = useCallback(
    (then?: () => void) => {
      after.current = then ?? null;
      if (pushed.current) {
        pushed.current = false;
        window.history.back(); // `popstate` below finishes the close
      } else {
        finish();
      }
    },
    [finish],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        latest.current.onOpen?.();
        setOpen(true);
      },
      close,
    }),
    [close],
  );

  useEffect(() => {
    if (!open) return;
    // Same URL, the router's state kept: only the Back gesture should notice this entry. Marked, so
    // an effect re-run (React StrictMode) doesn't stack a second one.
    const push = () => {
      const state: unknown = window.history.state;
      const base = state && typeof state === "object" ? state : {};
      if ((base as Record<string, unknown>).ujcModal !== entryId) {
        window.history.pushState({ ...base, ujcModal: entryId }, "");
      }
    };
    push();
    pushed.current = true;
    const onPop = () => {
      if (!pushed.current) {
        finish(); // our own `history.back()` from `close()`
        return;
      }
      const { onBack: back, onDismiss: dismiss } = latest.current;
      if (back) {
        back();
        push();
        return;
      }
      pushed.current = false;
      dismiss?.();
      finish();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, finish, entryId]);

  const dismiss = () => {
    latest.current.onDismiss?.();
    close();
  };

  return <Sheet {...sheet} open={open} onClose={dismiss} onEscape={onBack ?? dismiss} />;
}
