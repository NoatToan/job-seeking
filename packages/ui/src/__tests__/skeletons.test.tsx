import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DescriptionSkeleton, JobCardSkeleton, JobDetailSkeleton, JobListItemSkeleton, Skeleton } from "../index";

afterEach(() => cleanup());

/** Class list of the root element a skeleton renders. */
function rootClasses(ui: React.ReactElement): string[] {
  const { container } = render(ui);
  return (container.firstElementChild?.getAttribute("class") ?? "").split(/\s+/);
}

describe("skeletons", () => {
  it("Skeleton shimmers, but not with reduced motion, and is hidden from assistive tech", () => {
    const { container } = render(<Skeleton className="h-3" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("animate-shimmer");
    expect(el.className).toContain("motion-reduce:animate-none");
  });

  it("JobListItemSkeleton has the JobListItem frame: 18px radius, border, p-3.5, 40px avatar", () => {
    const classes = rootClasses(<JobListItemSkeleton />);
    expect(classes).toEqual(expect.arrayContaining(["rounded-[18px]", "border", "border-separator", "p-3.5", "gap-3"]));
    const { container } = render(<JobListItemSkeleton />);
    expect(container.querySelector(".size-10.rounded-xl")).toBeTruthy();
  });

  it("JobListItemSkeleton blocks: two title lines, company, salary, remote, working-hours pill, footer", () => {
    const { container } = render(<JobListItemSkeleton />);
    const body = container.querySelector("[data-skeleton=job-list-item] > div")!;
    // title ×2, company line, salary/remote group, hours pill row, footer row
    expect(body.children).toHaveLength(6);
    expect(body.querySelectorAll(".rounded-full.h-6")).toHaveLength(1);
    // No Save button unless the row has actions.
    expect(container.querySelector(".ml-auto")).toBeNull();
    cleanup();
    const withActions = render(<JobListItemSkeleton actions />);
    expect(withActions.container.querySelector(".ml-auto.h-8")).toBeTruthy();
  });

  it("JobDetailSkeleton: 56px avatar header, badges, buttons, two cards, description", () => {
    const { container } = render(<JobDetailSkeleton />);
    const root = container.querySelector("[data-skeleton=job-detail]")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".size-14.rounded-2xl")).toBeTruthy();
    // header, badges, buttons, "Who can apply", "Working hours", "About the role"
    expect(root.children).toHaveLength(6);
    expect(root.querySelectorAll(".rounded-card")).toHaveLength(2);
  });

  it("JobDetailSkeleton panel shows Apply + Track + Open page; page shows Track only", () => {
    const panel = render(<JobDetailSkeleton variant="panel" />);
    expect(panel.container.querySelectorAll("[data-skeleton=job-detail] > :nth-child(3) > *")).toHaveLength(3);
    cleanup();
    const page = render(<JobDetailSkeleton variant="page" />);
    expect(page.container.querySelectorAll("[data-skeleton=job-detail] > :nth-child(3) > *")).toHaveLength(1);
  });

  it("JobCardSkeleton matches JobCard's card and adds the action row only when asked", () => {
    expect(rootClasses(<JobCardSkeleton />)).toEqual(
      expect.arrayContaining(["rounded-card", "bg-grouped-secondary", "p-4", "shadow-card"]),
    );
    const plain = render(<JobCardSkeleton />);
    expect(plain.container.querySelector(".hairline-t")).toBeNull();
    cleanup();
    const actions = render(<JobCardSkeleton actions />);
    expect(actions.container.querySelector(".hairline-t")).toBeTruthy();
  });

  it("DescriptionSkeleton renders the requested number of body lines", () => {
    const { container } = render(<DescriptionSkeleton lines={4} />);
    expect(container.querySelectorAll(".text-body")).toHaveLength(4);
  });
});
