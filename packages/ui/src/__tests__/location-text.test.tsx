import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { findCountries, flagEmoji, LocationText } from "../components/location-text";

describe("LocationText", () => {
  afterEach(cleanup);

  it("puts a flag before each country name", () => {
    const { container } = render(<LocationText text="Remote, United States / Germany" />);
    expect(container.textContent).toBe(`Remote, ${flagEmoji("US")}United States / ${flagEmoji("DE")}Germany`);
  });

  it("knows aliases and uppercase codes, but not words inside other words", () => {
    expect(findCountries("Remote - USA").map((c) => c.code)).toEqual(["US"]);
    expect(findCountries("London, UK").map((c) => c.code)).toEqual(["GB"]);
    expect(findCountries("Austin, TX, US").map((c) => c.code)).toEqual(["US"]);
    expect(findCountries("Indianapolis, Indiana").map((c) => c.code)).toEqual([]);
    expect(findCountries("Newark, New Jersey").map((c) => c.code)).toEqual([]);
    expect(findCountries("open to people in us").map((c) => c.code)).toEqual([]);
    expect(findCountries("Ho Chi Minh City, Vietnam").map((c) => c.code)).toEqual(["VN"]);
  });

  it("leaves text without countries untouched", () => {
    const { container } = render(<LocationText text="Anywhere" />);
    expect(container.textContent).toBe("Anywhere");
  });
});
