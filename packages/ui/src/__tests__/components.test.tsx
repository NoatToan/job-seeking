import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@ujc/core";
import {
  Button,
  CodeField,
  JobCard,
  MatchBadge,
  ProgressSteps,
  SearchField,
  SegmentedControl,
  Sheet,
  SourceBadge,
  Toggle,
  matchBand,
} from "../index";

afterEach(cleanup);

describe("Button", () => {
  it("is disabled and aria-busy while loading, and ignores clicks", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

function Segmented() {
  const [v, setV] = useState<"board" | "list" | "calendar">("board");
  return (
    <SegmentedControl
      label="View"
      value={v}
      onChange={setV}
      options={[
        { value: "board", label: "Board" },
        { value: "list", label: "List" },
        { value: "calendar", label: "Calendar" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("exposes a radiogroup with one checked radio and roving tabindex", () => {
    render(<Segmented />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves selection and focus with arrow keys, wrapping, and Home/End", () => {
    render(<Segmented />);
    const board = screen.getByRole("radio", { name: "Board" });
    board.focus();
    fireEvent.keyDown(board, { key: "ArrowRight" });
    const list = screen.getByRole("radio", { name: "List" });
    expect(list.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(list);

    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("radio", { name: "Calendar" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "Calendar" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Board" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "Board" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Calendar" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "Calendar" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "Board" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("Toggle", () => {
  it("is a switch whose aria-checked follows clicks", () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Toggle label="Remote only" checked={on} onChange={setOn} />;
    }
    render(<Harness />);
    const sw = screen.getByRole("switch", { name: "Remote only" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("does not change when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle label="Digest" checked={false} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SearchField", () => {
  it("shows a clear button only with text; clearing empties, notifies and refocuses", () => {
    const onChange = vi.fn();
    render(<SearchField onChange={onChange} />);
    const input = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    fireEvent.change(input, { target: { value: "next.js" } });
    expect(onChange).toHaveBeenLastCalledWith("next.js");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears on Escape", () => {
    render(<SearchField defaultValue="react" />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });
});

describe("Sheet", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Move to…" footer={<button type="button">Done</button>}>
          <button type="button">Applied</button>
        </Sheet>
      </>
    );
  }

  it("is a labelled modal dialog, moves focus inside, traps Tab, closes on Escape and restores focus", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Move to…" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last.
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(done);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("CodeField", () => {
  it("keeps digits only and calls onComplete once full", () => {
    const onComplete = vi.fn();
    function Harness() {
      const [v, setV] = useState("");
      return <CodeField value={v} onChange={setV} onComplete={onComplete} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText("6-digit code") as HTMLInputElement;
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    fireEvent.change(input, { target: { value: "12a3 456" } });
    expect(input.value).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });
});

describe("badges and JobCard", () => {
  const job: Job = {
    id: "1",
    source: "greenhouse",
    url: "https://example.com/1",
    applyUrl: null,
    title: "Senior Frontend Engineer",
    company: "Acme",
    location: "Ho Chi Minh City",
    remote: true,
    employmentType: "full_time",
    salaryText: null,
    tags: ["react"],
    openTo: ["WORLDWIDE"],
    postedAt: null,
    firstSeenAt: new Date().toISOString(),
    match: { score: 88, summary: "Strong React match", missingSkills: ["GraphQL"] },
  };

  it("bands scores with friendly labels", () => {
    expect(matchBand(90).label).toBe("Great fit");
    expect(matchBand(72).label).toBe("Good fit");
    expect(matchBand(55).label).toBe("Worth a look");
    expect(matchBand(10).label).toBe("Long shot");
  });

  it("MatchBadge announces the score in words (pill and ring)", () => {
    render(
      <>
        <MatchBadge score={88} />
        <MatchBadge score={42} variant="ring" />
      </>,
    );
    expect(screen.getByText("CV fit 88 out of 100, great fit")).toBeTruthy();
    expect(screen.getByText("CV fit 42 out of 100, long shot")).toBeTruthy();
  });

  it("SourceBadge keeps its {source} API and names the source", () => {
    render(<SourceBadge source="greenhouse" />);
    expect(screen.getByTitle("Crawled from Greenhouse").textContent).toContain("Greenhouse");
  });

  it("JobCard keeps its {job} API: title links to the original posting, source + fit shown", () => {
    render(<JobCard job={job} />);
    const link = screen.getByRole("link", { name: /Senior Frontend Engineer/ });
    expect(link.getAttribute("href")).toBe("https://example.com/1");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Greenhouse")).toBeTruthy();
    expect(screen.getByText("Remote · Worldwide")).toBeTruthy();
    expect(screen.getByText("Full-time")).toBeTruthy();
    expect(screen.getByText(/GraphQL/)).toBeTruthy();
  });

  it("ProgressSteps marks the current step", () => {
    render(<ProgressSteps steps={["Sign in", "Your CV", "Keywords"]} current={1} label="Setup" />);
    const current = screen.getByRole("listitem", { current: "step" });
    expect(current.textContent).toContain("Your CV");
  });
});
