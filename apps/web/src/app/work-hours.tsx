"use client";

import { useMemo, useState } from "react";
import type { Job } from "@ujc/core";
import { Badge, Card, ClockIcon, FuzzySelect } from "@ujc/ui";
import type { SelectOption } from "@ujc/ui";
import { timezoneOptions, useUserTimezone } from "@/lib/user-timezone";
import {
  clockLabel,
  FIT_LABELS,
  FIT_TONES,
  jobZonesLabel,
  offsetLabel,
  shortZoneName,
  workHoursFit,
  WORKDAY_END,
  WORKDAY_START,
  zoneLabel,
  zoneOffsetMinutes,
} from "@/lib/work-hours";

/** "Your time zone" picker (fuzzy search over every zone, all in the browser). Changing it
 * re-labels every job's hours at once. */
export function TimezonePicker({ className }: { className?: string }) {
  const { zone, setZone } = useUserTimezone();
  const [saving, setSaving] = useState(false);
  const offset = zoneOffsetMinutes(zone);
  const options = useMemo<SelectOption[]>(
    () =>
      timezoneOptions(zone).map((z) => {
        const o = zoneOffsetMinutes(z);
        return {
          value: z,
          label: z.replace(/_/g, " "),
          hint: o === null ? undefined : offsetLabel(o),
          keywords: shortZoneName(z),
        };
      }),
    [zone],
  );
  return (
    <span className={`flex items-center gap-2 text-subheadline text-label-secondary ${className ?? ""}`}>
      <ClockIcon size={15} aria-hidden />
      <span>Your time zone</span>
      <FuzzySelect
        label="Your time zone"
        value={zone}
        disabled={saving}
        options={options}
        searchPlaceholder="City, region or VNT/EST…"
        onChange={(next) => {
          setSaving(true);
          void setZone(next).finally(() => setSaving(false));
        }}
      />
      {offset !== null ? <span className="text-footnote">{offsetLabel(offset)}</span> : null}
    </span>
  );
}

/** "21:00–05:00" on the user's clock, with "(+1)" when the end falls on the next day. */
function userRange(start: number, end: number): string {
  const nextDay = Math.floor(end / (24 * 60)) > Math.floor(start / (24 * 60)) || end === 24 * 60;
  return `${clockLabel(start)}–${clockLabel(end)}${nextDay ? " (+1)" : ""}`;
}

/**
 * Job row (Slack request: "show the time zone converted to VNT on the job item"): the job's 9–5
 * on the user's clock first, then how well it fits — e.g. "🕘 21:00–05:00 VNT · Night shift".
 */
export function WorkHoursBadge({ job }: { job: Job }) {
  const { zone } = useUserTimezone();
  const fit = workHoursFit(job.timezones, zone);
  if (!fit) return null;
  const abbr = shortZoneName(zone);
  return (
    <Badge
      tone={FIT_TONES[fit.level]}
      icon={<ClockIcon size={11} strokeWidth={2.25} />}
      title={`${FIT_LABELS[fit.level]}: the job's 9–5 in ${zoneLabel(fit.zone)} is ${userRange(fit.userStart, fit.userEnd)} ${abbr}`}
    >
      <span className="font-semibold tabular-nums">
        {clockLabel(fit.userStart)}–{clockLabel(fit.userEnd)} {abbr}
      </span>
      <span aria-hidden> · </span>
      {FIT_LABELS[fit.level]}
    </Badge>
  );
}

const DAY_MIN = 24 * 60;

/** Segments (in % of the user's day) covered by [start, end) minutes, split at midnight. */
function daySegments(start: number, end: number): { left: number; width: number }[] {
  const s = ((start % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const length = end - start;
  const parts = s + length <= DAY_MIN ? [[s, s + length]] : [[s, DAY_MIN], [0, s + length - DAY_MIN]];
  return parts.map(([a, b]) => ({ left: (a / DAY_MIN) * 100, width: ((b - a) / DAY_MIN) * 100 }));
}

const BAR_TONE: Record<string, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** 24-hour strip of the user's day: their 9–5 outlined, the job's hours filled in. */
function DayTimeline({ start, end, tone }: { start: number; end: number; tone: string }) {
  return (
    <div aria-hidden className="mt-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-fill-tertiary">
        {daySegments(start, end).map((seg, i) => (
          <span
            key={i}
            className={`absolute inset-y-0 ${BAR_TONE[tone] ?? "bg-tint"} opacity-80`}
            style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
          />
        ))}
        <span
          className="absolute inset-y-0 rounded-full ring-2 ring-inset ring-label/60"
          style={{ left: `${(9 / 24) * 100}%`, width: `${(8 / 24) * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-caption tabular-nums text-label-tertiary">
        {["00", "06", "12", "18", "24"].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  );
}

/** Detail panel (Slack: "the time zone in the detail is hard to read"): the job's hours and the
 * same hours on the user's clock side by side, plus a 24-hour timeline of the user's day. */
export function WorkHoursCard({ job }: { job: Job }) {
  const { zone } = useUserTimezone();
  const fit = workHoursFit(job.timezones, zone);
  if (!job.timezones?.length) {
    return (
      <Card className="shadow-none">
        <p className="flex items-center gap-2 text-headline text-label">
          <ClockIcon size={18} aria-hidden /> Working hours
        </p>
        <p className="mt-1 text-subheadline text-label-secondary">
          No time zone stated — likely flexible or worldwide. Check the posting before applying.
        </p>
      </Card>
    );
  }
  if (!fit) return null;
  const hours = Math.round((fit.overlapMinutes / 60) * 10) / 10;
  const diffHours = fit.diffMinutes / 60;
  const abbr = shortZoneName(zone);
  const ahead =
    fit.diffMinutes === 0
      ? "Same clock as you"
      : `You are ${Math.abs(diffHours)}h ${diffHours > 0 ? "ahead" : "behind"}`;
  return (
    <Card className="shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-headline text-label">
          <ClockIcon size={18} aria-hidden /> Working hours
        </p>
        <Badge tone={FIT_TONES[fit.level]}>{FIT_LABELS[fit.level]}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
        <dt className="text-subheadline text-label-secondary">Your time</dt>
        <dd className="text-title3 font-semibold tabular-nums text-label">
          {userRange(fit.userStart, fit.userEnd)} <span className="text-headline text-label-secondary">{abbr}</span>
        </dd>
        <dt className="text-subheadline text-label-secondary">Job&apos;s time</dt>
        <dd className="text-body tabular-nums text-label">
          {clockLabel(WORKDAY_START)}–{clockLabel(WORKDAY_END)}{" "}
          <span className="text-label-secondary">{zoneLabel(fit.zone)}</span>
        </dd>
      </dl>
      <DayTimeline start={fit.userStart} end={fit.userEnd} tone={FIT_TONES[fit.level]} />
      <p className="mt-2 text-footnote text-label-secondary">
        {hours > 0 ? `${hours}h overlap with your 9–5 (outlined)` : "No overlap with your 9–5 (outlined)"} · {ahead}
        {job.timezones.length > 1 ? ` · accepts ${jobZonesLabel(job.timezones)}` : ""}
        {job.timezoneSource === "location" ? " · inferred from the job's location" : " · stated in the posting"}
      </p>
    </Card>
  );
}
