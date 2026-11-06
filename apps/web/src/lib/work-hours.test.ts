import { describe, expect, it } from "vitest";
import {
  canonicalZone,
  clockLabel,
  jobZonesLabel,
  workHoursFit,
  zoneLabel,
  zoneOffsetMinutes,
} from "./work-hours";

// Winter (no DST in the northern hemisphere): New York UTC-5, London UTC+0, Berlin UTC+1.
const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("zoneOffsetMinutes", () => {
  it("reads fixed offsets and IANA zones, DST-aware", () => {
    expect(zoneOffsetMinutes("UTC+07:00")).toBe(420);
    expect(zoneOffsetMinutes("UTC-05:30")).toBe(-330);
    expect(zoneOffsetMinutes("Asia/Ho_Chi_Minh", WINTER)).toBe(420);
    expect(zoneOffsetMinutes("America/New_York", WINTER)).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", SUMMER)).toBe(-240);
    expect(zoneOffsetMinutes("Europe/London", WINTER)).toBe(0);
    expect(zoneOffsetMinutes("Not/A_Zone")).toBeNull();
  });
});

describe("canonicalZone", () => {
  it("maps legacy aliases browsers report", () => {
    expect(canonicalZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalZone("Europe/Berlin")).toBe("Europe/Berlin");
  });
});

describe("labels", () => {
  it("formats zones and clocks", () => {
    expect(zoneLabel("America/New_York")).toBe("New York");
    expect(zoneLabel("UTC-05:00")).toBe("UTC-5");
    expect(zoneLabel("UTC+05:30")).toBe("UTC+5:30");
    expect(clockLabel(21 * 60)).toBe("21:00");
    expect(clockLabel(29 * 60)).toBe("05:00");
    expect(jobZonesLabel(["UTC-08:00", "UTC-07:00", "UTC-06:00", "UTC-05:00"])).toBe("UTC-8 … UTC-5");
  });
});

describe("workHoursFit (user in Vietnam, UTC+7)", () => {
  const vn = "Asia/Ho_Chi_Minh";

  it("same zone", () => {
    const fit = workHoursFit(["Asia/Ho_Chi_Minh"], vn, WINTER)!;
    expect(fit.level).toBe("same");
    expect(fit.overlapMinutes).toBe(8 * 60);
  });

  it("Singapore (+1h) is a good overlap", () => {
    const fit = workHoursFit(["Asia/Singapore"], vn, WINTER)!;
    expect(fit.level).toBe("good");
    expect(fit.diffMinutes).toBe(-60);
    expect(clockLabel(fit.userStart)).toBe("08:00");
  });

  it("London 9–5 is 16:00–24:00 in Vietnam: evening hours", () => {
    const fit = workHoursFit(["Europe/London"], vn, WINTER)!;
    expect(clockLabel(fit.userStart)).toBe("16:00");
    expect(fit.overlapMinutes).toBe(60);
    expect(fit.level).toBe("evening");
  });

  it("New York 9–5 is 21:00–05:00 in Vietnam: night shift", () => {
    const fit = workHoursFit(["America/New_York"], vn, WINTER)!;
    expect(clockLabel(fit.userStart)).toBe("21:00");
    expect(fit.level).toBe("night");
  });

  it("picks the best of several accepted zones", () => {
    const fit = workHoursFit(["America/New_York", "UTC+08:00"], vn, WINTER)!;
    expect(fit.zone).toBe("UTC+08:00");
    expect(fit.level).toBe("good");
  });

  it("returns null when the job's zones are unknown", () => {
    expect(workHoursFit(null, vn)).toBeNull();
    expect(workHoursFit([], vn)).toBeNull();
  });
});

describe("workHoursFit (user in Sydney)", () => {
  it("Mumbai 9–5 is 14:30–22:30 in Sydney (summer): partial overlap", () => {
    const fit = workHoursFit(["Asia/Kolkata"], "Australia/Sydney", WINTER)!;
    expect(clockLabel(fit.userStart)).toBe("14:30");
    expect(fit.level).toBe("partial");
  });

  it("a US-west job starts at 04:00 in Sydney: only a partial overlap", () => {
    const fit = workHoursFit(["America/Los_Angeles"], "Australia/Sydney", WINTER)!;
    expect(clockLabel(fit.userStart)).toBe("04:00");
    expect(fit.overlapMinutes).toBe(3 * 60);
    expect(fit.level).toBe("partial");
  });
});
