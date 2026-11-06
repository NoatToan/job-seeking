"use client";

import { useId, useState } from "react";
import type { Job } from "@ujc/core";
import { Badge, Card, ClockIcon } from "@ujc/ui";
import { timezoneOptions, useUserTimezone } from "@/lib/user-timezone";
import {
  clockLabel,
  dayShiftLabel,
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

/** "Your time zone" picker. Changing it re-labels every job's hours at once. */
export function TimezonePicker({ className }: { className?: string }) {
  const { zone, setZone } = useUserTimezone();
  const [saving, setSaving] = useState(false);
  const id = useId();
  const offset = zoneOffsetMinutes(zone);
  return (
    <label htmlFor={id} className={`flex items-center gap-2 text-subheadline text-label-secondary ${className ?? ""}`}>
      <ClockIcon size={15} aria-hidden />
      <span>Your time zone</span>
      <select
        id={id}
        aria-label="Your time zone"
        value={zone}
        disabled={saving}
        onChange={(e) => {
          setSaving(true);
          void setZone(e.target.value).finally(() => setSaving(false));
        }}
        className="max-w-[16rem] truncate rounded-control-sm bg-fill-tertiary px-2 py-1 text-subheadline text-label focus-ring disabled:opacity-60"
      >
        {timezoneOptions(zone).map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {offset !== null ? <span className="text-footnote">{offsetLabel(offset)}</span> : null}
    </label>
  );
}

/** Compact fit badge for a job row ("Good overlap", "Night shift"); nothing when unknown. */
export function WorkHoursBadge({ job }: { job: Job }) {
  const { zone } = useUserTimezone();
  const fit = workHoursFit(job.timezones, zone);
  if (!fit) return null;
  return (
    <Badge
      tone={FIT_TONES[fit.level]}
      title={`${FIT_LABELS[fit.level]}: the job's 9–5 (${zoneLabel(fit.zone)}) is ${clockLabel(fit.userStart)}–${clockLabel(fit.userEnd)} your time`}
    >
      {/* Slack request: the job's hours converted to the user's zone, right on the row. */}
      {FIT_LABELS[fit.level]} · {clockLabel(fit.userStart)}–{clockLabel(fit.userEnd)} {shortZoneName(zone)}
    </Badge>
  );
}

/** Detail-panel card: the job's 09:00–17:00 on the user's clock, and how much overlaps. */
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
  const ahead =
    fit.diffMinutes === 0
      ? "same clock as you"
      : `you are ${Math.abs(diffHours)}h ${diffHours > 0 ? "ahead" : "behind"}`;
  return (
    <Card className="shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-headline text-label">
          <ClockIcon size={18} aria-hidden /> Working hours
        </p>
        <Badge tone={FIT_TONES[fit.level]}>{FIT_LABELS[fit.level]}</Badge>
      </div>
      <p className="mt-2 text-body text-label">
        {clockLabel(WORKDAY_START)}–{clockLabel(WORKDAY_END)} {zoneLabel(fit.zone)}
        <span className="text-label-secondary"> = </span>
        <span className="font-semibold">
          {clockLabel(fit.userStart)}
          {dayShiftLabel(fit.userStart)}–{clockLabel(fit.userEnd)}
          {dayShiftLabel(fit.userEnd)}
        </span>{" "}
        your time ({zoneLabel(zone)})
      </p>
      <p className="mt-1 text-footnote text-label-secondary">
        {hours > 0 ? `${hours}h overlap with your 9–5` : "No overlap with your 9–5"} · {ahead}
        {job.timezones.length > 1 ? ` · accepts ${jobZonesLabel(job.timezones)}` : ""}
        {job.timezoneSource === "location" ? " · inferred from the job's location" : " · stated in the posting"}
      </p>
    </Card>
  );
}
