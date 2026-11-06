"use client";

import { isRegionToken, remoteAccess } from "@ujc/core";
import type { RemoteAccess } from "@ujc/core";
import { cx } from "../cx";
import { AlertTriangleIcon, CheckIcon, GlobeIcon, XIcon } from "../icons";
import { useUiStrings } from "../strings";
import type { UiStrings } from "../strings";
import { flagEmoji } from "./location-text";

/** Country name in the UI language ("VN" → "Vietnam" / "Việt Nam"), falling back to the code. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "🇺🇸 US, 🇨🇦 CA, APAC" (short, for list rows) or "🇺🇸 United States, APAC" (long). */
export function remotePlacesLabel(places: string[], strings: UiStrings, long = false, max = 3): string {
  const shown = places.slice(0, max).map((p) => {
    if (isRegionToken(p)) return strings.remoteAccess.regions[p] ?? p;
    const name = long ? countryName(p, strings.locale) : p;
    return `${flagEmoji(p)} ${name}`.trim();
  });
  return shown.join(", ") + (places.length > max ? ` +${places.length - max}` : "");
}

const TONE = {
  yes: "text-success-ink",
  no: "text-danger-ink",
  unknown: "text-warning-ink",
  neutral: "text-info-ink",
} as const;

function toneFor(access: RemoteAccess): keyof typeof TONE {
  if (access.acceptsCandidate === true) return "yes";
  if (access.acceptsCandidate === false) return "no";
  if (access.scope === "unknown") return "unknown";
  return "neutral";
}

export interface RemoteAccessBadgeProps {
  /** The job's `openTo` tokens. */
  openTo: string[] | null | undefined;
  /** Where the candidate lives (ISO code); enables the open-to-you / not-open-to-you colouring. */
  basedIn?: string | null;
  className?: string;
}

/**
 * Who can apply to a remote job, stated plainly on the job row (Slack: "the remote region is very
 * important — make it clear so candidates don't waste time applying"):
 * "Remote · Worldwide", "Remote · 🇺🇸 US only", "Remote · region not stated". Green with a check
 * when it accepts the candidate's country, red with a cross when it doesn't, amber when unknown.
 */
export function RemoteAccessBadge({ openTo, basedIn, className }: RemoteAccessBadgeProps) {
  const strings = useUiStrings();
  const access = remoteAccess(openTo, basedIn);
  const tone = toneFor(access);
  const text =
    access.scope === "worldwide"
      ? strings.remoteAccess.worldwide
      : access.scope === "restricted"
        ? strings.remoteAccess.only(remotePlacesLabel(access.places, strings))
        : strings.remoteAccess.unknown;
  const you = basedIn ? countryName(basedIn, strings.locale) : null;
  const title =
    access.acceptsCandidate === true && you
      ? strings.remoteAccess.openToYou(you)
      : access.acceptsCandidate === false && you
        ? strings.remoteAccess.notOpenToYou(you)
        : undefined;
  const Icon = tone === "yes" ? CheckIcon : tone === "no" ? XIcon : tone === "unknown" ? AlertTriangleIcon : GlobeIcon;
  return (
    <span
      title={title}
      data-remote-access={tone}
      className={cx("inline-flex min-w-0 items-center gap-1 font-medium", TONE[tone], className)}
    >
      <Icon size={12} strokeWidth={2.5} aria-hidden className="shrink-0" />
      <span className="truncate">{text}</span>
      {title ? <span className="sr-only">. {title}</span> : null}
    </span>
  );
}

/**
 * Corner stamp on a job row, like a shop voucher tag, shown only when the job takes candidates from
 * the viewer's country. Most rows don't, so a red "not for you" on every one was noise; a green
 * "For you" on the few that fit is the thing worth spotting (a light sweep draws the eye once).
 * Rows that don't fit keep the "✕ Remote · US only" line.
 */
export function AccessStamp({ openTo, basedIn, className }: RemoteAccessBadgeProps) {
  const strings = useUiStrings();
  const access = remoteAccess(openTo, basedIn);
  if (access.acceptsCandidate !== true) return null;
  const you = basedIn ? countryName(basedIn, strings.locale) : "";
  return (
    <span
      data-access-stamp="open"
      title={strings.remoteAccess.openToYou(you)}
      className={cx(
        "pointer-events-none absolute -top-1 -left-1 z-[1] inline-flex items-center gap-1 overflow-hidden rounded-r-full rounded-tl-md bg-success py-0.5 pr-2.5 pl-2 text-[0.6875rem] font-bold tracking-wide text-white uppercase shadow-sm",
        // The fold: a small darker triangle under the tag's left end, as if it wraps the card edge.
        "after:absolute after:top-full after:left-0 after:border-t-[5px] after:border-l-[4px] after:border-t-[var(--ujc-stamp-open-fold)] after:border-l-transparent after:content-['']",
        className,
      )}
    >
      <CheckIcon size={11} strokeWidth={3} aria-hidden />
      {strings.remoteAccess.stampOpen}
      <span aria-hidden className="absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-white/45 animate-stamp-shine motion-reduce:hidden" />
    </span>
  );
}
