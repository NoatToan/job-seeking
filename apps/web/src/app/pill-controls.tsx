"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { ChevronDownIcon, cx } from "@ujc/ui";

/** Shared look of the filter pills: white pill with a hairline; tinted once it filters something. */
export function pillClasses(active: boolean): string {
  return cx(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border text-subheadline font-medium transition-colors duration-150 focus-ring",
    active
      ? "border-tint/40 bg-tint-soft text-tint-ink"
      : "border-separator bg-background text-label hover:bg-fill-tertiary",
  );
}

/**
 * Native `<select>` dressed as a filter pill (keeps the platform picker on phones and full
 * keyboard / screen-reader support). `active` = a non-default value is chosen.
 */
export function PillSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cx("relative inline-flex", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(pillClasses(Boolean(value)), "max-w-[14rem] appearance-none truncate pr-8 pl-3.5")}
      >
        {children}
      </select>
      <ChevronDownIcon
        size={14}
        strokeWidth={2.25}
        aria-hidden
        className={cx("pointer-events-none absolute top-1/2 right-3 -translate-y-1/2", value ? "text-tint-ink" : "text-label-tertiary")}
      />
    </span>
  );
}

/** On/off filter as a pill (`role="switch"`), e.g. "Remote", "Unread", "Best matches". */
export function PillToggle({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(pillClasses(checked), "px-3.5")}
    >
      {icon}
      {label}
    </button>
  );
}
