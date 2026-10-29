"use client";

import { useId, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { SearchIcon, XCircleFillIcon } from "../icons";

const fieldBase =
  "w-full bg-background text-body text-label placeholder:text-label-tertiary rounded-control " +
  "border border-control-border px-3 h-11 lg:h-10 transition-[border-color,box-shadow] duration-200 " +
  "focus:outline-none focus-visible:outline-none focus:border-tint focus:ring-4 focus:ring-tint/20 " +
  "disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visible label (always shown; placeholders are not labels). */
  label: string;
  /** Helper text under the field. */
  hint?: ReactNode;
  /** Error message; marks the field invalid and is announced with it. */
  error?: ReactNode;
}

export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-subheadline font-medium text-label">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(errorId, hintId) || undefined}
        className={fieldBase}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-footnote text-danger-ink">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-footnote text-label-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "size"> {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Accessible name. Default "Search". */
  label?: string;
  /** Accessible name of the clear button. Default "Clear search". */
  clearLabel?: string;
}

/** iOS-style search field: magnifier, rounded fill, clear (x) button while it has text. */
export function SearchField({
  value,
  defaultValue = "",
  onChange,
  label = "Search",
  clearLabel = "Clear search",
  placeholder = "Search",
  className,
  onKeyDown,
  ...rest
}: SearchFieldProps) {
  const [inner, setInner] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const inputRef = useRef<HTMLInputElement>(null);

  function set(next: string) {
    if (!controlled) setInner(next);
    onChange?.(next);
  }

  return (
    <div className={cx("relative flex items-center", className)}>
      <SearchIcon size={17} className="pointer-events-none absolute left-2.5 text-label-tertiary" />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={current}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && current) {
            e.preventDefault();
            set("");
          }
          onKeyDown?.(e);
        }}
        className={cx(
          "h-11 w-full rounded-control bg-fill-tertiary pl-9 pr-9 text-body text-label lg:h-9",
          "placeholder:text-label-tertiary transition-shadow duration-200",
          "focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-tint",
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
        )}
        {...rest}
      />
      {current ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            set("");
            inputRef.current?.focus();
          }}
          className="absolute right-0 flex size-11 items-center justify-center text-label-tertiary hover:text-label-secondary focus-ring rounded-full lg:size-9"
        >
          <XCircleFillIcon size={17} />
        </button>
      ) : null}
    </div>
  );
}

export interface CodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once when all digits are entered (e.g. auto-submit). */
  onComplete?: (value: string) => void;
  length?: number;
  /** Accessible name. Default "6-digit code". */
  label?: string;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/**
 * One-time code input (email OTP). One real <input> (so paste, autofill `one-time-code`, screen
 * readers and IME all work) drawn as separate digit boxes.
 */
export function CodeField({
  value,
  onChange,
  onComplete,
  length = 6,
  label = `${length}-digit code`,
  error,
  disabled,
  autoFocus,
  className,
}: CodeFieldProps) {
  const [focused, setFocused] = useState(false);
  const digits = value.slice(0, length).split("");
  return (
    <div className={cx("relative inline-flex gap-2", className)}>
      {Array.from({ length }, (_, i) => {
        const active = focused && (i === digits.length || (i === length - 1 && digits.length === length));
        return (
          <span
            key={i}
            aria-hidden
            className={cx(
              "flex h-14 w-11 items-center justify-center rounded-control bg-fill-tertiary text-title2 tabular-nums text-label transition-[box-shadow,background-color] duration-200",
              error ? "ring-2 ring-danger" : active ? "bg-background ring-2 ring-tint" : "ring-1 ring-inset ring-separator",
            )}
          >
            {digits[i] ?? ""}
          </span>
        );
      })}
      <input
        aria-label={label}
        aria-invalid={error || undefined}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length && next !== value) onComplete?.(next);
        }}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 focus:outline-none"
      />
    </div>
  );
}
