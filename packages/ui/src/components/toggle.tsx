"use client";

import type { ButtonHTMLAttributes } from "react";
import { cx } from "../cx";

export interface ToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. Omit only when `aria-labelledby` points at a visible label. */
  label?: string;
}

/** iOS switch (51x31). On = system green, the universal "on" colour; state is also in aria-checked. */
export function Toggle({ checked, onChange, label, className, disabled, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-0.5 transition-colors duration-300 ease-spring focus-ring",
        "before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
        checked ? "bg-success" : "bg-fill ring-1 ring-inset ring-separator",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cx(
          "size-[27px] rounded-full bg-white shadow-raised transition-transform duration-300 ease-spring",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
