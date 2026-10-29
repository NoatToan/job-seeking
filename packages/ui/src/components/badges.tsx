import type { ReactNode } from "react";
import { sourceMeta } from "@ujc/core";
import { cx } from "../cx";
import { XIcon } from "../icons";

export type Tone = "neutral" | "tint" | "success" | "warning" | "danger" | "info";

// Soft = 12% (light) / 18% (dark) hue over the surface with an "-ink" text colour (all >= 4.5:1).
const soft: Record<Tone, string> = {
  neutral: "bg-fill-secondary text-label-secondary",
  tint: "bg-tint-soft text-tint-ink",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  info: "bg-info-soft text-info-ink",
};
const solid: Record<Tone, string> = {
  neutral: "bg-label-secondary text-background",
  tint: "bg-tint text-on-tint",
  success: "bg-success text-background",
  warning: "bg-warning text-background",
  danger: "bg-danger text-background",
  info: "bg-info text-background",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  variant?: "soft" | "solid";
  icon?: ReactNode;
  className?: string;
  title?: string;
}

/** Small status label (pill). Use for application status, "New", "Remote", counts. */
export function Badge({ children, tone = "neutral", variant = "soft", icon, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-caption font-semibold",
        variant === "soft" ? soft[tone] : solid[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export interface ChipProps {
  children: ReactNode;
  /** Filter chips: pressed state (aria-pressed). Omit for a static chip. */
  selected?: boolean;
  onClick?: () => void;
  /** Shows a remove (x) button with this accessible name prefix, e.g. "Remove". */
  onRemove?: () => void;
  removeLabel?: string;
  icon?: ReactNode;
  className?: string;
}

/** Tag / filter chip. Static (skills, tags), toggleable (filters) or removable (entered keywords). */
export function Chip({ children, selected, onClick, onRemove, removeLabel = "Remove", icon, className }: ChipProps) {
  const look = cx(
    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-subheadline font-medium transition-colors duration-200",
    selected ? "bg-tint text-on-tint" : "bg-fill-tertiary text-label hover:bg-fill-secondary",
    className,
  );
  if (onClick) {
    return (
      <button type="button" aria-pressed={selected ?? undefined} onClick={onClick} className={cx(look, "focus-ring")}>
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span className={cx(look, onRemove && "pr-1")}>
      {icon}
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${removeLabel} ${typeof children === "string" ? children : ""}`.trim()}
          className="relative flex size-6 items-center justify-center rounded-full text-label-secondary hover:bg-fill focus-ring before:absolute before:-inset-2.5 before:content-['']"
        >
          <XIcon size={14} strokeWidth={2.25} />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Where a job came from. Brand colour is kept for the dot (identity) while the label stays in
 * `label` colour on a 12% wash of the brand hue, so every source passes AA in light and dark.
 */
export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const meta = sourceMeta(source);
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full pl-2 pr-2.5 text-caption font-semibold text-label",
        "bg-[color-mix(in_srgb,var(--src)_12%,transparent)] dark:bg-[color-mix(in_srgb,var(--src)_24%,transparent)]",
        className,
      )}
      style={{ ["--src" as string]: meta.color }}
      title={`Crawled from ${meta.label}`}
    >
      <span
        aria-hidden
        className="size-2 rounded-full bg-[var(--src)] dark:bg-[color-mix(in_oklab,var(--src)_70%,white)]"
      />
      {meta.label}
    </span>
  );
}

export interface MatchBand {
  tone: Tone;
  label: string;
}

/** Score bands used everywhere a CV fit score is shown. Labels are friendly, never judgmental. */
export function matchBand(score: number): MatchBand {
  if (score >= 85) return { tone: "success", label: "Great fit" };
  if (score >= 70) return { tone: "info", label: "Good fit" };
  if (score >= 50) return { tone: "warning", label: "Worth a look" };
  return { tone: "neutral", label: "Long shot" };
}

const ringStroke: Record<Tone, string> = {
  neutral: "var(--ujc-label-tertiary)",
  tint: "var(--ujc-tint)",
  success: "var(--ujc-success)",
  warning: "var(--ujc-warning)",
  danger: "var(--ujc-danger)",
  info: "var(--ujc-info)",
};

export interface MatchBadgeProps {
  /** CV fit score 0-100 (Claude). */
  score: number;
  /** "ring" = Activity-style progress ring with the number inside; "pill" = compact text badge. */
  variant?: "ring" | "pill";
  /** Ring diameter in px. Default 40. */
  size?: number;
  /** Show the band label next to the pill ("87 · Great fit"). */
  showLabel?: boolean;
  className?: string;
}

export function MatchBadge({ score, variant = "pill", size = 40, showLabel = false, className }: MatchBadgeProps) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const band = matchBand(s);
  const a11y = `CV fit ${s} out of 100, ${band.label.toLowerCase()}`;
  if (variant === "pill") {
    return (
      <Badge tone={band.tone} className={className} title={`CV fit score (Claude): ${band.label}`}>
        <span aria-hidden>
          {s}
          {showLabel ? ` · ${band.label}` : ""}
        </span>
        <span className="sr-only">{a11y}</span>
      </Badge>
    );
  }
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      title={`CV fit score (Claude): ${band.label}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ujc-fill)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringStroke[band.tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - s / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-spring"
        />
      </svg>
      <span aria-hidden className="absolute text-footnote font-bold tabular-nums text-label">
        {s}
      </span>
      <span className="sr-only">{a11y}</span>
    </span>
  );
}
