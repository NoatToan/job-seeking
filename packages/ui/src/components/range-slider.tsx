"use client";

import type { CSSProperties } from "react";
import { cx } from "../cx";

export interface RangeSliderProps {
  /** Accessible names of the two thumbs, e.g. ["From", "To"]. */
  labels: [string, string];
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Text for a thumb value (aria-valuetext), e.g. 9 -> "09:00". */
  format?: (v: number) => string;
  className?: string;
}

/**
 * Two-thumb slider built from two native range inputs stacked on one track (keyboard, touch and
 * screen readers work out of the box). The thumbs can't cross: each stops one `step` short of
 * the other.
 */
export function RangeSlider({ labels, min, max, step = 1, value, onChange, format, className }: RangeSliderProps) {
  const [lo, hi] = value;
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const thumb =
    "pointer-events-none absolute inset-0 h-6 w-full appearance-none bg-transparent focus-visible:outline-none " +
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-tint [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-raised " +
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-tint [&::-moz-range-thumb]:bg-background " +
    "focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-tint/30";
  const fill: CSSProperties = { left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` };
  return (
    <div className={cx("relative h-6", className)}>
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-fill-secondary" />
      <div aria-hidden className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-tint" style={fill} />
      <input
        type="range"
        aria-label={labels[0]}
        aria-valuetext={format?.(lo)}
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi - step), hi])}
        className={thumb}
      />
      <input
        type="range"
        aria-label={labels[1]}
        aria-valuetext={format?.(hi)}
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + step)])}
        className={thumb}
      />
    </div>
  );
}
