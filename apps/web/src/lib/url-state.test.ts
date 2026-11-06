import { describe, expect, it } from "vitest";
import { parseAsHourRange, postedParams } from "./url-state";

describe("parseAsHourRange", () => {
  it("round-trips a working-hours range", () => {
    expect(parseAsHourRange.parse("9-17")).toEqual([9, 17]);
    expect(parseAsHourRange.serialize([18, 24])).toBe("18-24");
  });

  it("rejects malformed or impossible ranges", () => {
    for (const bad of ["", "9", "17-9", "9-9", "0-25", "a-b", "9-17-20"]) {
      expect(parseAsHourRange.parse(bad)).toBeNull();
    }
  });
});

describe("postedParams", () => {
  it("maps the Posted options to the API's hours / days", () => {
    expect(postedParams(null)).toEqual({});
    expect(postedParams("1h")).toEqual({ hours: 1 });
    expect(postedParams("7")).toEqual({ days: 7 });
  });

  it("counts 'today' from the visitor's local midnight", () => {
    expect(postedParams("today", new Date(2026, 10, 6, 14, 20))).toEqual({ hours: 15 });
    expect(postedParams("today", new Date(2026, 10, 6, 0, 5))).toEqual({ hours: 1 });
  });
});
