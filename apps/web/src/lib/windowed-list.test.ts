import { describe, expect, it } from "vitest";
import {
  OVERSCAN_ROWS,
  WINDOW_FROM_ROWS,
  handoffProgress,
  layoutRows,
  nextSelection,
  offsetToReveal,
  refreshWindow,
  rowAt,
  windowFor,
} from "./windowed-list";

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i));
/** n rows of 100px with a 10px gap: row i spans [110i, 110i + 100). */
const grid = (n: number) => layoutRows(ids(n), new Map(ids(n).map((id) => [id, 100])), 10);

describe("layoutRows", () => {
  it("uses measured heights and the average for rows never rendered", () => {
    const layout = layoutRows(["a", "b", "c"], new Map([["a", 100], ["c", 200]]), 10);
    expect(layout.heights).toEqual([100, 150, 200]);
    expect(layout.tops).toEqual([0, 110, 270]);
    expect(layout.total).toBe(470);
  });
});

describe("windowFor", () => {
  it("renders short lists whole", () => {
    expect(windowFor(grid(WINDOW_FROM_ROWS), 5000, 600)).toEqual({ start: 0, end: WINDOW_FROM_ROWS });
  });

  it("keeps ~50 rows around the viewport of a long list", () => {
    const layout = grid(1000);
    expect(rowAt(layout, 110 * 500)).toBe(500);
    const w = windowFor(layout, 110 * 500, 660); // rows 500–506 visible
    expect(w).toEqual({ start: 500 - OVERSCAN_ROWS, end: 506 + OVERSCAN_ROWS + 1 });
  });
});

describe("refreshWindow", () => {
  it("keeps the window while it still covers the viewport, moves it once it doesn't", () => {
    const layout = grid(1000);
    const w = windowFor(layout, 110 * 500, 660);
    expect(refreshWindow(w, layout, 110 * 505, 660)).toBe(w);
    const moved = refreshWindow(w, layout, 110 * 520, 660);
    expect(moved.start).toBe(520 - OVERSCAN_ROWS);
  });
});

describe("nextSelection", () => {
  const layout = grid(100);

  it("keeps the selection while at least half of it is visible", () => {
    expect(nextSelection(layout, 3, 110 * 3 + 40, 660)).toBeNull();
  });

  it("moves to the top visible row when the selection scrolls out above", () => {
    expect(nextSelection(layout, 3, 110 * 10, 660)).toBe(10);
    // Row 10 is cut more than in half: the next one takes it.
    expect(nextSelection(layout, 3, 110 * 10 + 60, 660)).toBe(11);
  });

  it("moves to the bottom visible row when the selection scrolls out below", () => {
    // Viewport shows rows 0–5 (0..660); row 40 is far below.
    expect(nextSelection(layout, 40, 0, 660)).toBe(5);
  });
});

describe("offsetToReveal", () => {
  const layout = grid(100);
  it("returns null when the row is fully visible, else the nearest offset", () => {
    expect(offsetToReveal(layout, 2, 0, 660)).toBeNull();
    expect(offsetToReveal(layout, 6, 0, 660)).toBe(110 * 6 + 100 - 660);
    expect(offsetToReveal(layout, 1, 300, 660)).toBe(110);
  });
});

describe("handoffProgress", () => {
  const layout = grid(100);
  it("is null while the selected row is fully visible", () => {
    expect(handoffProgress(layout, 3, 110 * 3, 660)).toBeNull();
  });
  it("grows as the row scrolls out above, towards the next row", () => {
    expect(handoffProgress(layout, 3, 110 * 3 + 25, 660)).toEqual({ next: 4, progress: 0.5 });
    expect(handoffProgress(layout, 3, 110 * 3 + 80, 660)).toEqual({ next: 4, progress: 1 });
  });
  it("points at the previous row when the selection leaves at the bottom", () => {
    // Row 6 spans 660..760; a viewport ending at 735 hides 25px of it.
    expect(handoffProgress(layout, 6, 75, 660)).toEqual({ next: 5, progress: 0.5 });
  });
});
