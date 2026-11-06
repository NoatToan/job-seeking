"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../cx";
import { fuzzyFilter } from "../fuzzy";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned secondary text (a count, an offset). */
  hint?: string;
  /** Extra words the search also matches (aliases, codes), not shown. */
  keywords?: string;
  icon?: ReactNode;
}

export interface FuzzySelectProps {
  /** Accessible name of the trigger (and the search box inside). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The full list. It lives in the browser and is filtered there — keep it small (≲ a few thousand). */
  options: readonly SelectOption[];
  /** Trigger text when `value` matches no option. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** "pill" = filter-bar pill (tinted when `active`); "field" = plain inline control. */
  variant?: "pill" | "field";
  /** Pill only: show the tinted "filter is on" look. Default: `value !== ""`. */
  active?: boolean;
  disabled?: boolean;
  /** Rows rendered at most (the rest is reachable by typing). */
  maxResults?: number;
  className?: string;
}

/**
 * Base select with client-side fuzzy search: click (or Enter / ↓) to open, type to filter the
 * whole list instantly, ↑/↓ + Enter to pick, Esc to close. For small data sets that are loaded
 * up front, so it never waits on the backend. ARIA combobox + listbox pattern.
 */
export function FuzzySelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  variant = "field",
  active,
  disabled = false,
  maxResults = 200,
  className,
}: FuzzySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const selected = options.find((o) => o.value === value);
  const results = useMemo(
    () => fuzzyFilter(options, query, (o) => `${o.label} ${o.keywords ?? ""}`).slice(0, maxResults),
    [options, query, maxResults],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    inputRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open]);

  function openList() {
    if (disabled) return;
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setCursor(Math.max(0, Math.min(idx, maxResults - 1)));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(option: SelectOption | undefined) {
    if (!option) return;
    onChange(option.value);
    close();
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[cursor]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  const isActive = active ?? value !== "";
  const trigger =
    variant === "pill"
      ? cx(
          "inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full border pr-3 pl-3.5 text-subheadline font-medium transition-colors duration-150 focus-ring",
          isActive
            ? "border-tint/40 bg-tint-soft text-tint-ink"
            : "border-separator bg-background text-label hover:bg-fill-tertiary",
        )
      : "inline-flex h-8 max-w-[18rem] items-center gap-1.5 rounded-control-sm bg-fill-tertiary pr-2 pl-2.5 text-subheadline text-label hover:bg-fill-secondary focus-ring";

  return (
    <div ref={rootRef} className={cx("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList();
          }
        }}
        className={cx(trigger, "disabled:opacity-60")}
      >
        {selected?.icon}
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDownIcon
          size={14}
          strokeWidth={2.25}
          aria-hidden
          className={cx("shrink-0 transition-transform duration-200", open && "rotate-180", isActive && variant === "pill" ? "text-tint-ink" : "text-label-tertiary")}
        />
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-50 mt-2 w-72 rounded-[18px] border border-separator bg-background p-1.5 shadow-overlay animate-pop-in">
          <div className="relative flex items-center">
            <SearchIcon size={15} aria-hidden className="pointer-events-none absolute left-2.5 text-label-tertiary" />
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              aria-activedescendant={results.length ? optionId(cursor) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onInputKey}
              className="h-9 w-full rounded-control bg-fill-tertiary pr-2 pl-8 text-subheadline text-label placeholder:text-label-tertiary focus:ring-2 focus:ring-tint focus:outline-none"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="mt-1.5 max-h-72 overflow-y-auto overscroll-contain">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-subheadline text-label-secondary">{emptyLabel}</li>
            ) : (
              results.map((o, i) => {
                const isSelected = o.value === value;
                return (
                  <li
                    key={o.value}
                    id={optionId(i)}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    onPointerMove={() => setCursor(i)}
                    onClick={() => pick(o)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-subheadline",
                      i === cursor ? "bg-fill-tertiary" : "",
                      isSelected ? "font-semibold text-tint-ink" : "text-label",
                    )}
                  >
                    {o.icon}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint ? <span className="shrink-0 text-footnote text-label-tertiary tabular-nums">{o.hint}</span> : null}
                    {isSelected ? <CheckIcon size={14} strokeWidth={2.5} aria-hidden className="shrink-0" /> : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
