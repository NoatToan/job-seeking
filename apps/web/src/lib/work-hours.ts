/**
 * Compares a job's working hours with the user's own time zone (Slack request — "store each
 * job's time zone when crawling, let the user pick their time zone, then show the job's working
 * hours relative to it").
 *
 * A job's zones come from the crawler (`Job.timezones`, job_crawler/timezones.py): IANA names or
 * fixed offsets "UTC±hh:mm". We assume a standard 09:00–17:00 day in the job's zone and measure
 * how much of it lands inside the user's own 09:00–17:00 (DST-aware, for the given date).
 */

/** Standard working day assumed for both sides, in minutes after midnight. */
export const WORKDAY_START = 9 * 60;
export const WORKDAY_END = 17 * 60;
const DAY = 24 * 60;

const FIXED_OFFSET = /^UTC([+-])(\d{2}):(\d{2})$/;

/** Offset from UTC in minutes for `zone` at `at` (e.g. Asia/Ho_Chi_Minh -> 420), or null if the
 * zone is unknown to this browser. */
export function zoneOffsetMinutes(zone: string, at: Date = new Date()): number | null {
  const fixed = FIXED_OFFSET.exec(zone);
  if (fixed) {
    const minutes = Number(fixed[2]) * 60 + Number(fixed[3]);
    return fixed[1] === "+" ? minutes : -minutes;
  }
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name || name === "GMT") return 0;
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === "+" ? minutes : -minutes;
  } catch {
    return null;
  }
}

/** "America/New_York" -> "New York"; "UTC-05:00" -> "UTC-5"; "UTC+05:30" -> "UTC+5:30". */
export function zoneLabel(zone: string): string {
  const fixed = FIXED_OFFSET.exec(zone);
  if (fixed) {
    const hours = String(Number(fixed[2]));
    return `UTC${fixed[1]}${hours}${fixed[3] === "00" ? "" : `:${fixed[3]}`}`;
  }
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

/** "UTC+7" style label for a minute offset. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** 1290 -> "21:30"; wraps into 0..24h. */
export function clockLabel(minutes: number): string {
  const v = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Waking hours: a job day that falls here but outside the workday is early/late, not night. */
const AWAKE_START = 7 * 60;
const AWAKE_END = 23 * 60;

/** Overlap in minutes of [start, end) with [from, to) of the user's day, trying ±1 day too. */
function overlapWith(start: number, end: number, from: number, to: number): { minutes: number } {
  let minutes = 0;
  for (const shift of [-DAY, 0, DAY]) {
    minutes = Math.max(minutes, Math.min(end + shift, to) - Math.max(start + shift, from));
  }
  return { minutes };
}

export type FitLevel = "same" | "good" | "partial" | "evening" | "night";

export interface WorkHoursFit {
  /** The job zone that suits the user best (the job may accept several). */
  zone: string;
  /** User offset minus job offset: how far ahead the user's clock is. */
  diffMinutes: number;
  /** The job's 09:00–17:00 expressed in the user's clock (minutes; may be <0 or >=24h). */
  userStart: number;
  userEnd: number;
  /** Minutes of the job's day that fall inside the user's 09:00–17:00. */
  overlapMinutes: number;
  level: FitLevel;
}

function level(diff: number, userStart: number, userEnd: number): FitLevel {
  if (diff === 0) return "same";
  const work = overlapWith(userStart, userEnd, WORKDAY_START, WORKDAY_END).minutes;
  if (work >= 6 * 60) return "good";
  if (work >= 2 * 60) return "partial";
  // Little workday overlap but mostly before 23:00: a workable evening shift. (The early side
  // can't qualify: an 8h day ending before 11:00 already overlaps 9–5 by 2h, i.e. "partial".)
  const awake = overlapWith(userStart, userEnd, AWAKE_START, AWAKE_END).minutes;
  return awake >= 4 * 60 ? "evening" : "night";
}

/** Best fit across the job's zones for a user in `userZone`, or null if nothing is known. */
export function workHoursFit(
  jobZones: readonly string[] | null | undefined,
  userZone: string,
  at: Date = new Date(),
): WorkHoursFit | null {
  const userOffset = zoneOffsetMinutes(userZone, at);
  if (userOffset === null || !jobZones?.length) return null;
  let best: WorkHoursFit | null = null;
  for (const zone of jobZones) {
    const jobOffset = zoneOffsetMinutes(zone, at);
    if (jobOffset === null) continue;
    const diff = userOffset - jobOffset;
    const userStart = WORKDAY_START + diff;
    const userEnd = WORKDAY_END + diff;
    const overlap = overlapWith(userStart, userEnd, WORKDAY_START, WORKDAY_END).minutes;
    const fit: WorkHoursFit = {
      zone,
      diffMinutes: diff,
      userStart,
      userEnd,
      overlapMinutes: overlap,
      level: level(diff, userStart, userEnd),
    };
    if (
      !best ||
      overlap > best.overlapMinutes ||
      (overlap === best.overlapMinutes && Math.abs(diff) < Math.abs(best.diffMinutes))
    ) {
      best = fit;
    }
  }
  return best;
}

/** "+1 day" / "-1 day" / "" for where a user-clock minute falls relative to the job's day. */
export function dayShiftLabel(minutes: number): string {
  if (minutes >= DAY) return " (+1 day)";
  if (minutes < 0) return " (-1 day)";
  return "";
}

export const FIT_LABELS: Record<FitLevel, string> = {
  same: "Same time zone",
  good: "Good overlap",
  partial: "Partial overlap",
  evening: "Evening hours",
  night: "Night shift",
};

export const FIT_TONES: Record<FitLevel, "success" | "info" | "warning" | "danger"> = {
  same: "success",
  good: "success",
  partial: "info",
  evening: "warning",
  night: "danger",
};

/** "UTC-8 … UTC-5" for a job accepting a range of fixed offsets, else the zone labels joined. */
export function jobZonesLabel(zones: readonly string[]): string {
  if (zones.length > 2 && zones.every((z) => FIXED_OFFSET.test(z))) {
    return `${zoneLabel(zones[0])} … ${zoneLabel(zones[zones.length - 1])}`;
  }
  return zones.map(zoneLabel).join(", ");
}

/** The browser's own zone, or Asia/Ho_Chi_Minh if the runtime can't tell (SSR / old engines). */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}
