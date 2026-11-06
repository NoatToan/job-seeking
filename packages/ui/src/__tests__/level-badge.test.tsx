import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Job } from "@ujc/core";
import { JOB_LEVELS } from "@ujc/core";
import { EN_UI_STRINGS, JobListItem, LevelBadge, UiStringsProvider } from "../index";

afterEach(cleanup);

const job: Job = {
  id: "1",
  source: "greenhouse",
  url: "https://example.test/1",
  applyUrl: null,
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  remote: false,
  employmentType: null,
  salaryText: null,
  tags: [],
  openTo: null,
  postedAt: null,
  firstSeenAt: "2026-11-01T00:00:00Z",
  level: "senior",
  levelSource: "title",
};

describe("LevelBadge", () => {
  it("shows a short label, an accessible name and where the level came from", () => {
    const { container } = render(<LevelBadge level="senior" source="title" />);
    expect(screen.getByText("Senior")).toBeTruthy();
    expect(screen.getByText("Level: Senior")).toBeTruthy();
    const badge = container.querySelector("[data-level]")!;
    expect(badge.getAttribute("data-level")).toBe("senior");
    expect(badge.getAttribute("title")).toBe("Level: Senior · from the job title");
    expect(badge.className).toContain("bg-info-soft");
    expect(container.querySelector("svg[data-bars='3']")).toBeTruthy();
  });

  it("has one look per level: early career green, IC ladder teal with bars, management amber", () => {
    const tones = JOB_LEVELS.map((level) => {
      const { container, unmount } = render(<LevelBadge level={level} />);
      const cls = container.querySelector("[data-level]")!.className;
      const bars = container.querySelector("svg[data-bars]")?.getAttribute("data-bars") ?? null;
      unmount();
      return [level, cls.match(/bg-(\w+)-soft/)![1], bars];
    });
    expect(tones).toEqual([
      ["intern", "success", null],
      ["junior", "success", "1"],
      ["mid", "info", "2"],
      ["senior", "info", "3"],
      ["lead", "info", "4"],
      ["manager", "warning", null],
      ["director", "warning", null],
    ]);
  });

  it("renders nothing for a missing or unknown level", () => {
    const { container } = render(
      <>
        <LevelBadge level={null} />
        <LevelBadge level="wizard" />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("uses the app's translations", () => {
    const vi = {
      ...EN_UI_STRINGS,
      levels: { ...EN_UI_STRINGS.levels, names: { ...EN_UI_STRINGS.levels.names, manager: "Quản lý" }, aria: (l: string) => `Cấp bậc: ${l}` },
    };
    render(
      <UiStringsProvider value={vi}>
        <LevelBadge level="manager" />
      </UiStringsProvider>,
    );
    expect(screen.getByText("Cấp bậc: Quản lý")).toBeTruthy();
  });
});

describe("JobListItem level", () => {
  it("shows the level badge on the row, and none when the level is unknown", () => {
    const { container, unmount } = render(<JobListItem job={job} href="/jobs/1" />);
    expect(container.querySelector("[data-level='senior']")).toBeTruthy();
    unmount();
    const { container: plain } = render(<JobListItem job={{ ...job, level: null }} href="/jobs/1" />);
    expect(plain.querySelector("[data-level]")).toBeNull();
  });
});
