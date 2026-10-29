"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from "../icons";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss. Default 4000 (errors 7000). 0 = stay until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const icons: Record<ToastTone, ReactNode> = {
  success: <CheckCircleIcon size={22} className="text-success" />,
  error: <AlertTriangleIcon size={22} className="text-danger" />,
  info: <InfoIcon size={22} className="text-tint" />,
};

export interface ToastProps extends ToastOptions {
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}

/** Visual toast (iOS banner style). Usually rendered by ToastProvider; exported for previews. */
export function Toast({ title, message, tone = "info", action, onDismiss, dismissLabel = "Dismiss", className }: ToastProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card material-thick p-3 pl-4 shadow-overlay animate-toast-in",
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">{icons[tone]}</span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-subheadline font-semibold text-label">{title}</p>
        {message ? <p className="text-footnote text-label-secondary">{message}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="h-8 shrink-0 rounded-full px-3 text-subheadline font-semibold text-tint hover:bg-tint-soft focus-ring"
        >
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-label-tertiary hover:bg-fill-tertiary focus-ring before:absolute before:-inset-1.5 before:content-['']"
        >
          <XIcon size={16} strokeWidth={2.25} />
        </button>
      ) : null}
    </div>
  );
}

interface ToastContextValue {
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Wrap the app once. Toasts stack at the top centre (below the nav bar), newest first, max 3. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setItems((list) => [{ ...options, id }, ...list].slice(0, 3));
      const duration = options.duration ?? (options.tone === "error" ? 7000 : 4000);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <Toast key={t.id} {...t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
