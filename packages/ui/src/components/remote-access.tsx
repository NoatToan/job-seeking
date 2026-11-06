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
