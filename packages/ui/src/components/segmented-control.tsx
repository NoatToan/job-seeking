"use client";

import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../cx";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is not plain text (e.g. an icon). */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "View". */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Radio group styled as an iOS segmented control. Arrow keys move and select (wrapping),
 * Home/End jump to the ends; only the selected segment is in the tab order (roving tabindex).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function select(index: number) {
    const n = options.length;
    const i = ((index % n) + n) % n;
    onChange(options[i].value);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(selected + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(selected - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(options.length - 1);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "relative grid rounded-control bg-fill-tertiary p-0.5",
        size === "md" ? "h-9" : "h-8",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-control-sm bg-background shadow-raised transition-transform duration-300 ease-spring dark:bg-background-tertiary"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${selected * 100}%)`,
        }}
      />
      {options.map((o, i) => {
        const isSelected = i === selected;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={o.ariaLabel}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cx(
              "relative z-10 flex items-center justify-center gap-1.5 rounded-control-sm px-3 text-subheadline transition-colors duration-200 focus-ring",
              isSelected ? "font-semibold text-label" : "font-medium text-label-secondary hover:text-label",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
