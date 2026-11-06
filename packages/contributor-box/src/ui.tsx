"use client";

/**
 * Minimal primitives styled with Sunrise-compatible Tailwind token utilities (see README
 * "Theme contract"). The host's Tailwind must scan this package (`@source`) and define the tokens.
 */

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { FeedbackKind, FeedbackStatus } from "./types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "filled" | "tinted" | "gray" | "plain" | "destructive";

const VARIANTS: Record<Variant, string> = {
  filled: "bg-tint text-on-tint hover:bg-tint-pressed",
  tinted: "bg-tint-soft text-tint-ink hover:bg-tint-soft/80",
  gray: "bg-fill-tertiary text-label hover:bg-fill-secondary",
  plain: "text-tint hover:bg-fill-tertiary",
  destructive: "bg-danger-soft text-danger-ink hover:bg-danger-soft/80",
};

export function Button({
  variant = "gray",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-control font-semibold transition-colors duration-150 focus-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "min-h-8 px-3 text-footnote" : "min-h-11 px-4 text-subheadline",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export const inputClasses =
  "w-full rounded-control border border-control-border bg-background px-3 py-2 text-body text-label placeholder:text-label-tertiary focus:border-tint focus:outline-none focus:ring-4 focus:ring-tint/20";

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-footnote font-medium text-label-secondary">
      {children}
    </label>
  );
}

const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: "bg-fill-tertiary text-label-secondary",
  under_review: "bg-warning-soft text-warning-ink",
  approved: "bg-info-soft text-info-ink",
  planned: "bg-tint-soft text-tint-ink",
  done: "bg-success-soft text-success-ink",
  rejected: "bg-danger-soft text-danger-ink",
};

export function StatusBadge({ status, label }: { status: FeedbackStatus; label: string }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-caption font-medium", STATUS_TONE[status])}>
      {label}
    </span>
  );
}

/** Inline SVG icons in the host's style (24px grid, 1.75 stroke, currentColor). */
function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const XIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChatIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    <path d="M8.5 11h7M8.5 14h4" />
  </Icon>
);

export const UpIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m6 14 6-6 6 6" />
  </Icon>
);

const KIND_ICON: Record<FeedbackKind, ReactNode> = {
  // bug
  bug: <path d="M9 9h6v7a3 3 0 0 1-6 0V9Zm3-4a3 3 0 0 0-3 3v1h6V8a3 3 0 0 0-3-3ZM4 13h5M15 13h5M5 8l4 2M19 8l-4 2M5 19l4-2M19 19l-4-2" />,
  // speech bubble
  feedback: <path d="M20 12a7 7 0 0 1-10.2 6.2L5 19l.9-4A7 7 0 1 1 20 12Z" />,
  // light bulb
  idea: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z" />,
};

export function KindBadge({ kind, label }: { kind: FeedbackKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-fill-tertiary px-2 py-0.5 text-caption text-label-secondary">
      <Icon size={12}>{KIND_ICON[kind]}</Icon>
      {label}
    </span>
  );
}

/** Radio-group pill control (roving focus via native radios). */
export function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            "cursor-pointer rounded-full px-3 py-1.5 text-footnote font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-tint",
            o.value === value ? "bg-tint text-on-tint" : "bg-fill-tertiary text-label hover:bg-fill-secondary",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function formatDate(iso: string | null, locale?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
}

const RELATIVE_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "3 days ago" / "3 ngày trước" in `locale`. Empty for a missing or invalid date. */
export function relativeTime(iso: string | null, locale: string, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  let value = (then - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return "";
}
