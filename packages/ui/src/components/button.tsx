import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type ButtonVariant = "filled" | "tinted" | "gray" | "plain" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold " +
  "transition-[background-color,color,transform,opacity] duration-200 ease-spring active:scale-[0.97] " +
  "focus-ring disabled:cursor-not-allowed";

const variants: Record<ButtonVariant, string> = {
  filled: "bg-tint text-on-tint hover:bg-tint-pressed",
  tinted: "bg-tint-soft text-tint-ink hover:bg-tint/20",
  gray: "bg-fill-secondary text-label hover:bg-fill",
  plain: "bg-transparent text-tint hover:bg-tint-soft",
  destructive: "bg-danger-soft text-danger-ink hover:bg-danger/20",
};

// sm is 32px tall for dense desktop toolbars; the ::before hit-slop keeps a 44px touch target.
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-subheadline rounded-control-sm before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']",
  md: "h-11 px-4 text-body rounded-control",
  lg: "h-[50px] px-5 text-headline rounded-card",
};

/** Class string for a button look on another element (e.g. an `<a>` or Next `<Link>`). */
export function buttonClasses({
  variant = "filled",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cx(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export function Spinner({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("animate-spin", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. The label stays for context. */
  loading?: boolean;
  /** Optional icon before the label. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = "filled",
  size = "md",
  loading = false,
  icon,
  fullWidth,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={buttonClasses({
        variant,
        size,
        fullWidth,
        className: cx(disabled && !loading && "opacity-40", className),
      })}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 16} /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name (required: icon-only buttons have no visible text). */
  label: string;
  icon: ReactNode;
  variant?: "plain" | "gray" | "tinted" | "filled";
  size?: "sm" | "md";
}

const iconVariants = {
  plain: "text-tint hover:bg-fill-tertiary",
  gray: "bg-fill-secondary text-label-secondary hover:bg-fill",
  tinted: "bg-tint-soft text-tint-ink hover:bg-tint/20",
  filled: "bg-tint text-on-tint hover:bg-tint-pressed",
} as const;

export function IconButton({
  label,
  icon,
  variant = "plain",
  size = "md",
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-200 ease-spring active:scale-[0.94] focus-ring disabled:opacity-40",
        size === "md" ? "size-11" : "size-8 before:absolute before:-inset-1.5 before:content-['']",
        iconVariants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
