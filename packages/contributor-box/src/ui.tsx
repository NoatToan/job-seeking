"use client";

/**
 * Minimal primitives styled with Sunrise-compatible Tailwind token utilities (see README
 * "Theme contract"). The host's Tailwind must scan this package (`@source`) and define the tokens.
 */

import { useState } from "react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { useContributor } from "./context";
import { safeHref } from "./safe-url";
import type { FeedbackKind, FeedbackStatus, PublicAuthor, VoteValue } from "./types";

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

export const DownIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m6 10 6 6 6-6" />
  </Icon>
);

export const CommentIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 12a7 7 0 0 1-10.2 6.2L5 19l.9-4A7 7 0 1 1 20 12Z" />
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

// --- people --------------------------------------------------------------------------------------

/** Avatar tones (server `avatar.tone` 0–4) as theme token pairs, so dark mode follows the host. */
const TONES = [
  "bg-tint-soft text-tint-ink",
  "bg-info-soft text-info-ink",
  "bg-success-soft text-success-ink",
  "bg-warning-soft text-warning-ink",
  "bg-fill-secondary text-label",
];

/** What to call someone: their name, else the pseudonym in the page's language. */
export function displayName(author: PublicAuthor | null | undefined, locale: string): string {
  if (!author) return "";
  if (author.name) return author.name;
  if (author.pseudonym) return locale.startsWith("vi") ? author.pseudonym.vi : author.pseudonym.en;
  return "";
}

export function Avatar({ author, size = 32 }: { author: PublicAuthor; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none",
        TONES[author.avatar.tone % TONES.length] ?? TONES[0],
      )}
    >
      {author.avatar.glyph}
    </span>
  );
}

/** Name plus badges: "Team", "Guest #123", "You". */
export function AuthorName({ author, isMine }: { author: PublicAuthor; isMine?: boolean }) {
  const { strings: s } = useContributor();
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="min-w-0 truncate font-semibold text-label">{displayName(author, s.locale)}</span>
      {author.team ? (
        <span className="rounded-full bg-tint-soft px-1.5 text-caption font-medium text-tint-ink">{s.teamBadge}</span>
      ) : null}
      {author.kind === "guest" ? (
        <span className="text-caption text-label-tertiary">
          {s.guestBadge}
          {author.tag ? ` #${author.tag}` : ""}
        </span>
      ) : null}
      {isMine ? <span className="text-caption text-label-tertiary">· {s.you}</span> : null}
    </span>
  );
}

// --- votes ---------------------------------------------------------------------------------------

export interface VoteState {
  score: number;
  myVote: VoteValue;
}

/** Score after the viewer changes their vote from `state.myVote` to `next`. */
export function applyVote(state: VoteState, next: VoteValue): VoteState {
  return { score: state.score - state.myVote + next, myVote: next };
}

/**
 * Stack Overflow style "▲ score ▼". Clicking the pressed arrow again removes the vote; the other
 * arrow switches it. Optimistic: the new score shows at once and rolls back if `onVote` throws.
 * Signed out: with the host's `onRequireSignIn` the arrows stay and ask to sign in first, then
 * cast that vote; with only `signInHref` the score links to sign-in.
 */
export function VoteControl({
  score,
  myVote,
  canVote,
  onVote,
  label,
  size = "md",
  horizontal = false,
}: VoteState & {
  /** "▲ 3 ▼" in a row (comments) instead of a column (items). */
  horizontal?: boolean;
  canVote: boolean;
  /** Persist the vote; resolve once the parent has the server's numbers. */
  onVote: (value: VoteValue) => Promise<unknown>;
  /** What is being voted on, for screen readers (e.g. the item title). */
  label?: string;
  size?: "md" | "sm";
}) {
  const { strings: s, signedIn, signInHref, onRequireSignIn, linkAs: Link } = useContributor();
  const [optimistic, setOptimistic] = useState<VoteState | null>(null);
  const [announce, setAnnounce] = useState("");
  const shown = optimistic ?? { score, myVote };
  const busy = optimistic !== null;
  const suffix = label ? `: ${label}` : "";
  const sm = size === "sm";

  // Signed out with an in-place sign-in: the real arrows, which sign in and then vote.
  const askFirst = !canVote && !signedIn && onRequireSignIn !== null;

  if (!canVote && !askFirst) {
    const scoreText = (
      <span className={cx("flex items-center", horizontal ? "flex-row gap-1" : "flex-col")} aria-hidden="true" title={signedIn ? undefined : s.signInToVote}>
        <UpIcon size={sm ? 12 : 14} />
        {shown.score}
      </span>
    );
    if (!signedIn && signInHref) {
      return (
        <Link
          href={signInHref}
          className={cx(
            "flex shrink-0 flex-col items-center justify-center rounded-control bg-fill-tertiary px-2 font-semibold text-label-secondary tabular-nums transition-colors duration-150 hover:bg-fill-secondary focus-ring",
            sm ? "min-h-9 min-w-9 text-caption" : "min-h-11 min-w-11 text-footnote",
          )}
        >
          <span className="sr-only">{`${s.signInToVote} (${s.score(shown.score)})${suffix}`}</span>
          {scoreText}
        </Link>
      );
    }
    return (
      <span
        className={cx(
          "flex shrink-0 items-center justify-center px-1 font-semibold text-label-secondary tabular-nums",
          horizontal ? "flex-row" : "flex-col",
          sm ? "min-w-8 text-caption" : "min-w-11 text-footnote",
        )}
      >
        <span className="sr-only">{s.score(shown.score)}</span>
        {scoreText}
      </span>
    );
  }

  const cast = async (direction: 1 | -1) => {
    if (busy) return;
    if (askFirst) {
      // After sign-in the parent refetches; the vote goes in with the visitor's new session.
      onRequireSignIn?.(() => {
        onVote(direction).then(
          () => setAnnounce(s.score(score + direction)),
          () => undefined,
        );
      });
      return;
    }
    const next: VoteValue = shown.myVote === direction ? 0 : direction;
    const after = applyVote(shown, next);
    setOptimistic(after);
    try {
      await onVote(next);
      setAnnounce(s.score(after.score));
    } catch {
      // Roll back: the parent never received new numbers, so the props still hold the old ones.
      setAnnounce(s.score(score));
    } finally {
      setOptimistic(null);
    }
  };

  const arrow = (direction: 1 | -1) => {
    const pressed = shown.myVote === direction;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        aria-label={`${direction === 1 ? s.upvote : s.downvote}${suffix}`}
        aria-disabled={busy || undefined}
        title={askFirst ? s.signInToVote : undefined}
        onClick={() => void cast(direction)}
        className={cx(
          "flex items-center justify-center rounded-control transition-colors duration-150 focus-ring",
          sm ? "size-7" : "size-9",
          pressed
            ? direction === 1
              ? "bg-tint text-on-tint"
              : "bg-danger-soft text-danger-ink"
            : "text-label-secondary hover:bg-fill-secondary",
        )}
      >
        {direction === 1 ? <UpIcon size={sm ? 14 : 18} /> : <DownIcon size={sm ? 14 : 18} />}
      </button>
    );
  };

  return (
    <div
      className={cx(
        "flex shrink-0 items-center rounded-control bg-fill-tertiary p-0.5",
        horizontal ? "flex-row gap-0.5" : "flex-col",
      )}
      role="group"
      aria-label={`${s.score(shown.score)}${suffix}`}
    >
      {arrow(1)}
      <span
        className={cx(
          "font-semibold tabular-nums",
          sm ? "text-caption" : "text-footnote",
          shown.myVote === 1 ? "text-tint" : shown.myVote === -1 ? "text-danger" : "text-label",
        )}
        aria-hidden="true"
      >
        {shown.score}
      </span>
      {arrow(-1)}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

// --- plain text with links ----------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?'")\]}]+$/;

/** Splits text into plain runs and http(s) URLs (trailing punctuation stays text). */
export function splitLinks(text: string): Array<{ text: string; href: string | null }> {
  const out: Array<{ text: string; href: string | null }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    const start = match.index ?? 0;
    const trail = url.match(TRAILING)?.[0] ?? "";
    // Keep a closing parenthesis that belongs to the URL, e.g. a Wikipedia link.
    let cut = trail.length;
    if (trail.startsWith(")") && (url.match(/\(/g)?.length ?? 0) > (url.slice(0, -trail.length).match(/\)/g)?.length ?? 0)) {
      cut -= 1;
    }
    url = cut > 0 ? url.slice(0, -cut) : url;
    const href = safeHref(url);
    if (start > last) out.push({ text: text.slice(last, start), href: null });
    out.push({ text: url, href });
    last = start + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), href: null });
  return out;
}

/**
 * User text rendered as text (React escapes it), with http(s) URLs as links marked
 * `nofollow ugc noopener` so comments cannot pass on ranking or reach `window.opener`.
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cx("whitespace-pre-wrap break-words", className)}>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="nofollow ugc noopener noreferrer"
            className="break-all text-tint underline focus-ring rounded-sm"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
