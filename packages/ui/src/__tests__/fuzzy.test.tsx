import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FuzzySelect } from "../components/fuzzy-select";
import type { SelectOption } from "../components/fuzzy-select";
import { fuzzyFilter, fuzzyMatch, fuzzyRank, fuzzyScore, TIER } from "../fuzzy";
import { countryKeywords } from "../search-keywords";

const ZONES = ["America/New_York", "Asia/Ho_Chi_Minh", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
const tier = (q: string, t: string) => Math.floor((fuzzyScore(q, t) ?? -1000) / 1000);

describe("fuzzy matching", () => {
  it("matches subsequences, ignores accents and ranks word starts first", () => {
    expect(fuzzyScore("hcm", "Asia/Ho_Chi_Minh")).not.toBeNull();
    expect(fuzzyScore("xyz", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(fuzzyScore("ho chi minh", "Hồ Chí Minh")).not.toBeNull();
    expect(fuzzyFilter(ZONES, "ny", (z) => z)[0]).toBe("America/New_York");
    expect(fuzzyFilter(ZONES, "tok", (z) => z)).toEqual(["Asia/Tokyo"]);
    expect(fuzzyFilter(ZONES, "", (z) => z)).toEqual(ZONES);
  });

  it("folds Vietnamese diacritics and đ both ways", () => {
    for (const q of ["viet", "việt", "VIỆT", "viet nam", "Việt Nam"]) expect(tier(q, "Việt Nam")).toBeGreaterThanOrEqual(TIER.prefix);
    expect(tier("viet", "Vietnam")).toBe(TIER.prefix);
    expect(tier("da nang", "Đà Nẵng")).toBe(TIER.exact);
    expect(tier("đà", "Da Nang")).toBe(TIER.prefix);
    expect(tier("ho chi minh", "Asia/Ho_Chi_Minh")).toBe(TIER.wordStart);
    expect(tier("hồ chí minh", "Asia/Ho_Chi_Minh")).toBe(TIER.wordStart);
  });

  it("ranks exact > prefix > word start > acronym > substring > words > subsequence", () => {
    expect(tier("java", "Java")).toBe(TIER.exact);
    expect(tier("java", "JavaScript")).toBe(TIER.prefix);
    expect(tier("york", "America/New_York")).toBe(TIER.wordStart);
    expect(tier("ny", "America/New_York")).toBe(TIER.acronym);
    expect(tier("ny", "Kenya")).toBe(TIER.substring);
    expect(tier("ny", "Australia/Sydney")).toBe(TIER.subsequence);
    expect(tier("minh ho", "Asia/Ho_Chi_Minh")).toBe(TIER.words);
    expect(tier("grmny", "Germany")).toBe(TIER.subsequence);
    const items = ["Sydney", "New York", "Nyborg", "NY", "Kenya"];
    expect(fuzzyFilter(items, "ny", (s) => s)).toEqual(["NY", "Nyborg", "New York", "Kenya", "Sydney"]);
  });

  it("prefers earlier and shorter matches inside a tier", () => {
    expect(fuzzyFilter(["Indiana", "India"], "ind", (s) => s)).toEqual(["India", "Indiana"]);
    expect(fuzzyFilter(["Papua New Guinea", "Guinea"], "guin", (s) => s)).toEqual(["Guinea", "Papua New Guinea"]);
  });

  it("returns the matched characters as indices into the original text", () => {
    expect(fuzzyMatch("viet", "Việt Nam")?.indices).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch("ny", "New York")?.indices).toEqual([0, 4]);
    expect(fuzzyMatch("grmny", "Germany")?.indices).toEqual([0, 2, 3, 5, 6]);
    // Emoji before the name (flags are 4 UTF-16 units) must not shift the marks.
    expect(fuzzyMatch("viet", "🇻🇳 Vietnam")?.indices).toEqual([5, 6, 7, 8]);
  });

  it("searches keywords (codes, aliases, other-language names) but highlights only the label", () => {
    const countries = ["US", "VN", "DE", "AU", "RU"].map((code) => ({ code, label: new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code }));
    const rank = (q: string) => fuzzyRank(countries, q, (c) => [c.label, ...countryKeywords(c.code)]);
    expect(rank("usa")[0].item.code).toBe("US");
    expect(rank("us")[0].item.code).toBe("US");
    expect(rank("us")[0].indices).toEqual([]);
    expect(rank("việt")[0].item.code).toBe("VN");
    expect(rank("viet nam")[0].item.code).toBe("VN");
    expect(rank("duc")[0].item.code).toBe("DE");
    expect(rank("vn").map((r) => r.item.code)).toEqual(["VN"]);
  });
});

const OPTIONS: SelectOption[] = [...ZONES, "Europe/London", "Asia/Bangkok", "Pacific/Auckland"].map((z) => ({ value: z, label: z }));

function Harness({ options = OPTIONS, name }: { options?: SelectOption[]; name?: string }) {
  const [v, setV] = useState("");
  return (
    <form>
      <FuzzySelect label="Zone" value={v} onChange={setV} placeholder="Any zone" options={options} name={name} />
      <output>{v}</output>
    </form>
  );
}

const output = () => document.querySelector("output")?.textContent;

describe("FuzzySelect", () => {
  afterEach(cleanup);

  it("filters as you type and picks with the keyboard", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    const search = screen.getByRole("searchbox", { name: "Search zone" });
    fireEvent.change(search, { target: { value: "sydny" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(output()).toBe("Australia/Sydney");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Zone" }).textContent).toContain("Australia/Sydney");
  });

  it("ranks the best match first and highlights the matched letters", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search zone" }), { target: { value: "hồ chí" } });
    const [top] = screen.getAllByRole("option");
    expect(top.textContent).toBe("Asia/Ho_Chi_Minh");
    expect([...top.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Ho_Chi"]);
  });

  it("moves with arrows, Home and End and closes on Esc", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Zone" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = screen.getByRole("searchbox", { name: "Search zone" });
    const active = () => document.getElementById(search.getAttribute("aria-activedescendant") ?? "")?.textContent;
    expect(active()).toBe("America/New_York");
    fireEvent.keyDown(search, { key: "End" });
    expect(active()).toBe("Pacific/Auckland");
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(active()).toBe("Asia/Bangkok");
    fireEvent.keyDown(search, { key: "Home" });
    expect(active()).toBe("America/New_York");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(output()).toBe("");
  });

  it("typing on the closed trigger opens it with that letter searched", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Zone" }), { key: "b" });
    expect((screen.getByRole("searchbox", { name: "Search zone" }) as HTMLInputElement).value).toBe("b");
  });

  it("short lists have no search box and jump by typed letters", () => {
    render(<Harness options={OPTIONS.slice(0, 3)} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    const list = screen.getByRole("listbox", { name: "Zone" });
    expect(document.activeElement).toBe(list);
    fireEvent.keyDown(list, { key: "e" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(output()).toBe("Europe/Berlin");
  });

  it("shows an empty state when nothing matches", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search zone" }), { target: { value: "qqq" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("renders only the rows in view for long lists, but every row is reachable", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ value: `z${i}`, label: `Zone ${String(i).padStart(3, "0")}` }));
    render(<Harness options={many} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    const rendered = screen.getAllByRole("option");
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0].getAttribute("aria-setsize")).toBe("500");
    const search = screen.getByRole("searchbox", { name: "Search zone" });
    fireEvent.keyDown(search, { key: "End" });
    expect(screen.getByRole("option", { name: "Zone 499" })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(output()).toBe("z499");
  });

  it("carries its value in a form through a hidden input", () => {
    render(<Harness name="zone" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Zone" }));
    fireEvent.click(screen.getByRole("option", { name: "Asia/Tokyo" }));
    expect(new FormData(document.querySelector("form")!).get("zone")).toBe("Asia/Tokyo");
  });
});
