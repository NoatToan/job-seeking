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
  if (!fitsCandidate(openTo, basedIn)) return null;
  const you = basedIn ? countryName(basedIn, strings.locale) : "";
  return (
    // Outer: position + drop shadow (a filter, because the inner clip-path would cut a box-shadow).
    <span
      data-access-stamp="open"
      title={strings.remoteAccess.openToYou(you)}
      className={cx(
        // Flush with the card's top border, 4px past its left edge (the list keeps 4px of room).
        "pointer-events-none absolute top-0 -left-1 z-[1] [filter:drop-shadow(0_2px_3px_rgb(0_0_0/0.28))]",
        className,
      )}
    >
      <span className="relative inline-flex h-[22px] items-center gap-1 overflow-hidden rounded-tl-[6px] bg-[image:var(--ujc-stamp-open-bg)] pr-4 pl-2.5 text-[0.6875rem] leading-none font-extrabold tracking-[0.06em] text-white uppercase shadow-[var(--ujc-stamp-open-shadow)] [clip-path:polygon(0_0,100%_0,calc(100%-8px)_50%,100%_100%,0_100%)] [text-shadow:0_1px_0_rgb(0_0_0/0.25)]">
        <CheckIcon size={11} strokeWidth={3.25} aria-hidden />
        {strings.remoteAccess.stampOpen}
        <span aria-hidden className="absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-white/40 animate-stamp-shine motion-reduce:hidden" />
      </span>
    </span>
  );
}

/** The fold under the ribbon's left end (outside the ribbon's clip-path, so it is its own node). */
export function AccessStampFold({ openTo, basedIn }: RemoteAccessBadgeProps) {
  if (!fitsCandidate(openTo, basedIn)) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-[22px] -left-1 z-[1] h-0 w-0 border-t-[5px] border-l-[4px] border-t-[var(--ujc-stamp-open-fold)] border-l-transparent"
    />
  );
}

/** Whether the posting takes candidates from `basedIn` (the stamp only shows then). */
export function fitsCandidate(openTo: string[] | null | undefined, basedIn: string | null | undefined): boolean {
  return remoteAccess(openTo, basedIn).acceptsCandidate === true;
}
