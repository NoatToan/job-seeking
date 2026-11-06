import { describe, expect, it } from "vitest";
import { parseAsHourRange } from "./url-state";

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
