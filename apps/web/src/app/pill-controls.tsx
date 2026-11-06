"use client";

import type { ReactNode } from "react";
import { cx, FuzzySelect } from "@ujc/ui";
import type { SelectOption } from "@ujc/ui";

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
 * Single-choice filter pill: our `FuzzySelect` in its pill look (never a native `<select>`).
 * Short fixed lists (Posted, Sort, Remote region) open without a search box; longer ones (Source)
 * get one. Phones get a bottom sheet. `active` = a non-default value is chosen (`value !== ""`).
 */
export function PillSelect({
  label,
  value,
  onChange,
  options,
  searchPlaceholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  searchPlaceholder?: string;
  className?: string;
}) {
  return (
    <FuzzySelect
      variant="pill"
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={options[0]?.label}
      searchPlaceholder={searchPlaceholder}
      className={cx("shrink-0", className)}
    />
  );
}

/** On/off filter as a pill (`role="switch"`), e.g. "Remote", "Unread", "Open to me". */
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
