import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JdSection, JobDetail as JobDetailType } from "@ujc/core";
import fixtures from "./__fixtures__/jd-jobs.json";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ me: null, loading: false, error: null, refresh: vi.fn(), signOut: vi.fn() }),
}));

import { groupSections, hasRecognisedSections, JdSections, toBlocks } from "./jd-sections";
import { JobDetail } from "./job-detail";

/** Real postings (one per source) as `GET /api/jobs/{id}` returns them, parsed by the crawler. */
const JOBS = fixtures as unknown as JobDetailType[];
const job = (id: string) => JOBS.find((j) => j.id === id)!;

afterEach(cleanup);

function sectionOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("section[data-section]")).map((s) => s.getAttribute("data-section")!);
}

describe("JdSections", () => {
  it("shows canonical sections in the fixed order with the same titles, whatever the posting called them", () => {
    // Ashby (PostHog): "WHO WE'RE LOOKING FOR" comes before "WHAT YOU'LL BE DOING" in the posting.
    const { container } = render(<JdSections sections={job("1881").sections!} />);
    expect(sectionOrder(container)).toEqual(["about_company", "responsibilities", "requirements"]);
    expect(screen.getByRole("heading", { level: 3, name: "About the company" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "What you'll do" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Requirements" })).toBeTruthy();
    // Two "requirements" blocks are one group, each keeping its own posting heading.
    const requirements = container.querySelector('section[data-section="requirements"]') as HTMLElement;
    expect(within(requirements).getByText("WHO WE'RE LOOKING FOR")).toBeTruthy();
    expect(within(requirements).getByText("REQUIREMENTS")).toBeTruthy();
  });

  it("renders the same canonical heading for every source", () => {
    for (const id of ["6253", "1668", "1881", "14016"]) {
      const { container, unmount } = render(<JdSections sections={job(id).sections!} />);
      const keys = sectionOrder(container);
      expect(keys.length).toBeGreaterThanOrEqual(3);
      // Sorted by the canonical order.
      const order = ["about_company", "about_role", "responsibilities", "requirements", "nice_to_have", "tech_stack", "compensation", "benefits", "location_remote", "hiring_process", "other", "equal_opportunity"];
      expect([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(keys);
      expect(screen.getAllByRole("heading", { level: 3, name: "Requirements" })).toHaveLength(1);
      unmount();
    }
  });

  it("shows Requirements and Nice to have as checklists", () => {
    const { container } = render(<JdSections sections={job("14016").sections!} />);
    expect(container.querySelector('section[data-section="requirements"] ul[data-layout="checklist"]')).toBeTruthy();
    expect(container.querySelector('section[data-section="nice_to_have"] ul[data-layout="checklist"]')).toBeTruthy();
    expect(container.querySelector('section[data-section="responsibilities"] ul[data-layout="checklist"]')).toBeNull();
  });

  it("shows short benefits as chips", () => {
    const sections: JdSection[] = [
      { key: "requirements", heading: "Requirements", body: "- Go", summary: "Go" },
      { key: "benefits", heading: "Perks", body: "- Remote\n- Equity\n- 30 days off\n- Laptop", summary: "" },
    ];
    const { container } = render(<JdSections sections={sections} />);
    const chips = container.querySelector('section[data-section="benefits"] ul[data-layout="chips"]');
    expect(chips?.querySelectorAll("li")).toHaveLength(4);
  });

  it("keeps the equal-opportunity statement folded until asked", () => {
    const { container } = render(<JdSections sections={job("6253").sections!} />);
    const eeo = container.querySelector('section[data-section="equal_opportunity"]') as HTMLElement;
    const toggle = within(eeo).getByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(eeo).queryByText(/Equal Employment Opportunity employer/)).toBeNull();
    fireEvent.click(toggle);
    expect(within(eeo).getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(eeo).getByText(/Equal Employment Opportunity employer/)).toBeTruthy();
  });

  it("folds long sections but opens one that holds a searched word, and highlights it", () => {
    const sections = job("1881").sections!;
    const { container, unmount } = render(<JdSections sections={sections} />);
    const about = container.querySelector('section[data-section="about_company"]') as HTMLElement;
    expect(within(about).getByRole("button", { name: "Show more" }).getAttribute("aria-expanded")).toBe("false");
    unmount();

    render(<JdSections sections={sections} highlight={["PostHog"]} />);
    const opened = document.querySelector('section[data-section="about_company"]') as HTMLElement;
    expect(within(opened).getByRole("button", { name: "Show less" })).toBeTruthy();
    expect(opened.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("splits a body into paragraphs, sub-headings and lists", () => {
    expect(toBlocks("Intro line.\nMust have:\n- Go\n- SQL\nAfter.")).toEqual([
      { kind: "p", text: "Intro line." },
      { kind: "sub", text: "Must have" },
      { kind: "list", items: ["Go", "SQL"] },
      { kind: "p", text: "After." },
    ]);
  });

  it("groups unknown keys under other and drops empty parts", () => {
    const groups = groupSections([
      { key: "benefits", heading: "B", body: "- x", summary: "x" },
      { key: "mystery" as JdSection["key"], heading: "M", body: "text", summary: "text" },
      { key: "requirements", heading: "R", body: "  ", summary: "" },
    ]);
    expect(groups.map((g) => g.key)).toEqual(["benefits", "other"]);
    expect(hasRecognisedSections([{ key: "intro", heading: null, body: "x", summary: "x" }])).toBe(false);
    expect(hasRecognisedSections(null)).toBe(false);
  });
});

describe("JobDetail with sections", () => {
  it("renders the sectioned layout and the level badge", () => {
    render(<JobDetail job={job("1668")} signedIn={false} />);
    expect(screen.getByRole("heading", { level: 2, name: "Job description" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "What you'll do" })).toBeTruthy();
    expect(screen.getByText("Level: Junior")).toBeTruthy();
  });

  it("falls back to the plain description when nothing was recognised", () => {
    const seek = job("8664");
    render(<JobDetail job={seek} signedIn={false} />);
    expect(screen.getByRole("heading", { level: 2, name: "About the role" })).toBeTruthy();
    expect(screen.getByText(seek.description!.slice(0, 30), { exact: false })).toBeTruthy();
    expect(document.querySelector("section[data-section]")).toBeNull();
    expect(document.querySelector("[data-level]")).toBeNull();
  });

  it("still highlights search words in the plain description", () => {
    const seek = job("8664");
    const word = seek.description!.split(/\s+/).find((w) => /^[A-Za-z]{5,}$/.test(w))!;
    render(<JobDetail job={seek} signedIn={false} highlight={[word]} />);
    expect(Array.from(document.querySelectorAll("mark")).some((m) => m.textContent === word)).toBe(true);
  });
});
