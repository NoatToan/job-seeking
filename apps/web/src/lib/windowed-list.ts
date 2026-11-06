/**
 * List windowing for the job list (Slack: "virtual DOM so loading many items doesn't hurt
 * performance — keep about 50 items around the viewport"). Rows have different heights, so each
 * rendered row is measured and remembered; rows never rendered yet use the average measured
 * height. Everything outside the window is replaced by one spacer above and one below, so the
 * scrollbar keeps the size of the whole list.
 *
 * The math is pure (no DOM) so it can be unit-tested; the component feeds it the scroll offset.
 */

/** Rows kept mounted on each side of the visible ones: ~50 around the viewport in total. */
export const OVERSCAN_ROWS = 25;
/** Short lists render every row: windowing only pays off once the DOM gets large. */
export const WINDOW_FROM_ROWS = 2 * OVERSCAN_ROWS + 10;
/** Height used for a row that has never been rendered, before any row has been measured. */
export const ESTIMATED_ROW_PX = 116;

export interface RowLayout {
  /** Top of each row, relative to the top of the list (gaps included). */
  tops: number[];
  /** Height of each row (without the gap). */
  heights: number[];
  /** Height of the whole list. */
  total: number;
}

export function layoutRows(ids: readonly string[], measured: ReadonlyMap<string, number>, gap: number): RowLayout {
  let sum = 0;
  let count = 0;
  for (const id of ids) {
    const h = measured.get(id);
    if (h !== undefined) {
      sum += h;
      count += 1;
    }
  }
  const fallback = count > 0 ? sum / count : ESTIMATED_ROW_PX;
  const tops: number[] = [];
  const heights: number[] = [];
  let y = 0;
  ids.forEach((id, i) => {
    if (i > 0) y += gap;
    const h = measured.get(id) ?? fallback;
    tops.push(y);
    heights.push(h);
    y += h;
  });
  return { tops, heights, total: y };
}

/** First row whose bottom is below `y` (binary search over the row tops). */
export function rowAt(layout: RowLayout, y: number): number {
  const { tops, heights } = layout;
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] + heights[mid] <= y) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo);
}

export interface RowWindow {
  start: number;
  /** Exclusive. */
  end: number;
}

/** Rows to mount for a viewport that starts `offset` px into the list and is `view` px tall. */
export function windowFor(layout: RowLayout, offset: number, view: number, overscan = OVERSCAN_ROWS): RowWindow {
  const n = layout.tops.length;
  if (n <= WINDOW_FROM_ROWS) return { start: 0, end: n };
  const first = rowAt(layout, Math.max(0, offset));
  const last = rowAt(layout, Math.max(0, offset + view));
  return { start: Math.max(0, first - overscan), end: Math.min(n, last + overscan + 1) };
}

/** Rows of slack kept before the window is moved again, so scrolling re-renders the list every
 * ~10 rows instead of on every row that crosses the edge. */
const WINDOW_SLACK_ROWS = 10;

/** The window to use after a scroll: `current` while it still covers the viewport with some
 * slack, otherwise a fresh one centred on the viewport. */
export function refreshWindow(current: RowWindow, layout: RowLayout, offset: number, view: number): RowWindow {
  const n = layout.tops.length;
  const fresh = windowFor(layout, offset, view);
  if (n <= WINDOW_FROM_ROWS) return current.start === 0 && current.end === n ? current : fresh;
  const first = rowAt(layout, Math.max(0, offset));
  const last = rowAt(layout, Math.max(0, offset + view));
  const covered =
    current.start <= Math.max(0, first - WINDOW_SLACK_ROWS) && current.end >= Math.min(n, last + WINDOW_SLACK_ROWS + 1);
  const tooBig = current.end - current.start > fresh.end - fresh.start + 4 * WINDOW_SLACK_ROWS;
  return covered && !tooBig ? current : fresh;
}

/** True when at least half of row `index` is inside the viewport. */
export function isMostlyVisible(layout: RowLayout, index: number, offset: number, view: number): boolean {
  const top = layout.tops[index];
  const h = layout.heights[index];
  if (top === undefined || h === undefined) return false;
  const shown = Math.min(top + h, offset + view) - Math.max(top, offset);
  return shown >= h / 2;
}

/**
 * Scroll-spy (Slack: "if the active job is still in the viewport, don't move the focus when the
 * user scrolls"). Returns the row to select after a scroll, or `null` to keep the current one:
 * the selection stays while at least half of it is visible; once it scrolls out, the nearest
 * mostly-visible row on that side takes over (the top row when scrolling down, the bottom row
 * when scrolling back up).
 */
export function nextSelection(layout: RowLayout, selected: number, offset: number, view: number): number | null {
  const n = layout.tops.length;
  if (n === 0) return null;
  const known = selected >= 0 && selected < n;
  if (known && isMostlyVisible(layout, selected, offset, view)) return null;
  const above = !known || layout.tops[selected] < offset;
  let i = Math.min(rowAt(layout, above ? offset : offset + view), n - 1);
  // Step inwards while the edge row is cut more than in half.
  const step = above ? 1 : -1;
  for (let k = 0; k < 3 && !isMostlyVisible(layout, i, offset, view); k++) {
    const next = i + step;
    if (next < 0 || next >= n) break;
    i = next;
  }
  return i === selected ? null : i;
}

/** Scroll offset that brings row `index` fully into view with the least movement, or `null` if
 * it already is (keyboard navigation: no animated scroll-to, just keep the row on screen). */
export function offsetToReveal(layout: RowLayout, index: number, offset: number, view: number): number | null {
  const top = layout.tops[index];
  const h = layout.heights[index];
  if (top === undefined || h === undefined) return null;
  if (top < offset) return top;
  if (top + h > offset + view) return top + h - view;
  return null;
}
