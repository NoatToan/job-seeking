import type { ReactNode } from "react";
import { cx } from "../cx";
import { CheckIcon } from "../icons";

/* ------------------------------------------------------------------ Skeleton */

/** Placeholder block. Decorative: put aria-busy + an accessible label on the container. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block animate-shimmer rounded-control-sm bg-fill-secondary", className)} />;
}

/** Same footprint as JobCard, so the list does not jump when data arrives. */
export function JobCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
      <div className="flex items-start gap-3">
        <Skeleton className="size-10 shrink-0 rounded-control" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <Skeleton className="size-10 shrink-0 rounded-full" />
      </div>
      <Skeleton className="h-3 w-4/5" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ EmptyState */

export type Illustration = "search" | "tracker" | "error" | "celebrate" | "connect" | "cv";

/** Friendly spot illustrations: one soft tint blob + a few line glyphs. 120x96, token colours only. */
export function SpotIllustration({ name, className }: { name: Illustration; className?: string }) {
  const line = "var(--ujc-label-tertiary)";
  const accent = name === "error" ? "var(--ujc-warning)" : "var(--ujc-tint-vivid)";
  return (
    <svg
      width="120"
      height="96"
      viewBox="0 0 120 96"
      fill="none"
      aria-hidden
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="60" cy="50" rx="46" ry="40" fill={name === "error" ? "color-mix(in srgb, var(--ujc-warning) var(--ujc-soft), transparent)" : "color-mix(in srgb, var(--ujc-tint) var(--ujc-soft), transparent)"} />
      {name === "search" ? (
        <>
          <circle cx="54" cy="44" r="18" stroke={line} strokeWidth="4" fill="var(--ujc-background)" />
          <path d="m67 57 14 14" stroke={line} strokeWidth="6" />
          <path d="M46 40a9 9 0 0 1 9-6" stroke={accent} strokeWidth="3" />
          <path d="m92 22 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={accent} />
          <circle cx="26" cy="30" r="3" fill={accent} />
        </>
      ) : null}
      {name === "tracker" ? (
        <>
          <rect x="30" y="26" width="44" height="54" rx="8" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <rect x="46" y="18" width="44" height="54" rx="8" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <path d="M56 34h24M56 44h18M56 54h22" stroke={line} strokeWidth="3" />
          <circle cx="88" cy="70" r="11" fill={accent} />
          <path d="m83 70 3.5 3.5L93 67" stroke="var(--ujc-background)" strokeWidth="3" />
        </>
      ) : null}
      {name === "error" ? (
        <>
          <path
            d="M38 68h44a14 14 0 0 0 1-28 20 20 0 0 0-38-4 16 16 0 0 0-7 32z"
            fill="var(--ujc-background)"
            stroke={line}
            strokeWidth="3"
          />
          <path d="M60 42v12" stroke={accent} strokeWidth="4" />
          <circle cx="60" cy="61" r="2.5" fill={accent} />
        </>
      ) : null}
      {name === "celebrate" ? (
        <>
          <path d="m34 76 14-40 26 26z" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <path d="M42 58 52 68M46 46l18 18" stroke={accent} strokeWidth="3" />
          <path d="M70 30c4-6 10-6 14-2M80 44c6-2 12 0 14 6" stroke={line} strokeWidth="3" />
          <circle cx="66" cy="18" r="3" fill={accent} />
          <circle cx="94" cy="32" r="3" fill="var(--ujc-success)" />
          <circle cx="90" cy="62" r="3" fill="var(--ujc-info)" />
          <path d="m78 14 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill={accent} />
        </>
      ) : null}
      {name === "connect" ? (
        <>
          <rect x="22" y="38" width="30" height="22" rx="7" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <rect x="68" y="38" width="30" height="22" rx="7" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <path d="M52 49h16" stroke={accent} strokeWidth="4" strokeDasharray="2 6" />
          <path d="M14 44v10M106 44v10" stroke={line} strokeWidth="3" />
        </>
      ) : null}
      {name === "cv" ? (
        <>
          <rect x="38" y="16" width="44" height="60" rx="8" fill="var(--ujc-background)" stroke={line} strokeWidth="3" />
          <circle cx="52" cy="32" r="6" stroke={line} strokeWidth="3" />
          <path d="M64 30h10M64 36h6M48 48h26M48 56h20M48 64h24" stroke={line} strokeWidth="3" />
          <path d="m88 20 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill={accent} />
        </>
      ) : null}
    </svg>
  );
}

export interface EmptyStateProps {
  illustration?: Illustration;
  title: ReactNode;
  message?: ReactNode;
  /** Primary action (usually a Button). */
  action?: ReactNode;
  /** Secondary action (usually a plain Button or link). */
  secondaryAction?: ReactNode;
  /** "error" announces the state (role=alert). */
  tone?: "neutral" | "error";
  className?: string;
}

export function EmptyState({
  illustration = "search",
  title,
  message,
  action,
  secondaryAction,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx("flex flex-col items-center gap-3 px-6 py-10 text-center animate-fade-in", className)}
    >
      <SpotIllustration name={illustration} />
      <h3 className="text-title3 text-label">{title}</h3>
      {message ? <p className="max-w-sm text-subheadline text-label-secondary">{message}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Avatar */

const avatarTones = [
  "bg-tint text-on-tint",
  "bg-info text-background",
  "bg-success text-background",
  "bg-label-secondary text-background",
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  /** Full name or email; used for initials, colour and alt text. */
  name: string;
  src?: string | null;
  size?: number;
  /** "circle" for people, "rounded" (app-icon squircle) for companies. */
  shape?: "circle" | "rounded";
  className?: string;
}

export function Avatar({ name, src, size = 36, shape = "circle", className }: AvatarProps) {
  const radius = shape === "circle" ? "rounded-full" : "rounded-control";
  const hash = Array.from(name).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const tone = avatarTones[hash % avatarTones.length];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} style={style} className={cx("shrink-0 object-cover", radius, className)} />;
  }
  return (
    <span
      role="img"
      aria-label={name}
      style={style}
      className={cx("inline-flex shrink-0 select-none items-center justify-center font-semibold", radius, tone, className)}
    >
      <span aria-hidden>{initials(name)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ ProgressSteps */

export interface ProgressStepsProps {
  steps: ReadonlyArray<string>;
  /** 0-based index of the current step. */
  current: number;
  /** Accessible name, e.g. "Setup progress". */
  label?: string;
  className?: string;
}

/** Onboarding stepper: done = filled tint with check, current = tint ring, upcoming = grey. */
export function ProgressSteps({ steps, current, label = "Progress", className }: ProgressStepsProps) {
  return (
    <ol aria-label={label} className={cx("flex w-full items-start", className)}>
      {steps.map((step, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className="relative flex flex-1 flex-col items-center gap-1.5 text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden
                className={cx(
                  "absolute top-3.5 right-1/2 h-0.5 w-[calc(100%-2rem)] -translate-x-4 rounded-full transition-colors duration-300",
                  i <= current ? "bg-tint" : "bg-fill",
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cx(
                "relative flex size-7 items-center justify-center rounded-full text-footnote font-semibold transition-all duration-300 ease-spring",
                state === "done" && "bg-tint text-on-tint",
                state === "current" && "bg-background text-tint-ink ring-2 ring-tint ring-offset-2 ring-offset-background",
                state === "upcoming" && "bg-fill-secondary text-label-secondary",
              )}
            >
              {state === "done" ? <CheckIcon size={15} strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cx(
                "px-1 text-caption",
                state === "current" ? "font-semibold text-label" : "text-label-secondary",
              )}
            >
              <span className="sr-only">
                {`Step ${i + 1} of ${steps.length}, ${state === "done" ? "completed" : state === "current" ? "current" : "not started"}: `}
              </span>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
