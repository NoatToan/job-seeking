import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FuzzySelect } from "../components/fuzzy-select";
import { fuzzyFilter, fuzzyScore } from "../fuzzy";

const ZONES = ["America/New_York", "Asia/Ho_Chi_Minh", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];

describe("fuzzy", () => {
  it("matches subsequences, ignores accents and ranks word starts first", () => {
    expect(fuzzyScore("hcm", "Asia/Ho_Chi_Minh")).not.toBeNull();
    expect(fuzzyScore("xyz", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(fuzzyScore("ho chi minh", "Hồ Chí Minh")).not.toBeNull();
    expect(fuzzyFilter(ZONES, "ny", (z) => z)[0]).toBe("America/New_York");
    expect(fuzzyFilter(ZONES, "tok", (z) => z)).toEqual(["Asia/Tokyo"]);
    expect(fuzzyFilter(ZONES, "", (z) => z)).toEqual(ZONES);
  });
});

describe("FuzzySelect", () => {
  afterEach(cleanup);

  function Harness() {
    const [v, setV] = useState("");
    return (
      <>
        <FuzzySelect
          label="Zone"
          value={v}
          onChange={setV}
          placeholder="Any zone"
          options={ZONES.map((z) => ({ value: z, label: z }))}
        />
        <output>{v}</output>
      </>
    );
  }

  it("filters as you type and picks with the keyboard", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    const search = screen.getByRole("searchbox", { name: "Search zone" });
    fireEvent.change(search, { target: { value: "sydny" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(document.querySelector("output")?.textContent).toBe("Australia/Sydney");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Zone" }).textContent).toContain("Australia/Sydney");
  });

  it("shows an empty state when nothing matches", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search zone" }), { target: { value: "qqq" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });
});
