"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../cx";
import { useUiStrings } from "../strings";
import { FloatingPanel } from "./floating-panel";
import { Sheet } from "./sheet";
import { fuzzyRank, normalize } from "../fuzzy";
import type { FuzzyResult } from "../fuzzy";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned secondary text (a count, an offset). */
  hint?: string;
  /** Extra words the search also matches (codes, aliases, other-language names); not shown. */
  keywords?: string | readonly string[];
  icon?: ReactNode;
}

/** Lists shorter than this open without a search box (Posted, Sort, a status): just pick. */
export const SEARCH_THRESHOLD = 7;
/** From this many rows on, only the rows in view (plus a margin) are in the DOM. */
const VIRTUAL_FROM = 60;
const OVERSCAN = 6;
const ROW = 36;
const SHEET_ROW = 48;
/** `max-h-72`: the popover list's height, also the fallback where layout can't be measured. */
const LIST_HEIGHT = 288;
const PHONE_QUERY = "(max-width: 767.98px)";

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const isPhone = () => typeof window !== "undefined" && window.matchMedia?.(PHONE_QUERY).matches === true;

export interface FuzzySelectProps {
  /** Accessible name of the trigger (and the search box / sheet title). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The full list. It lives in the browser and is ranked there; long lists are virtualised. */
  options: readonly SelectOption[];
  /** Trigger text when `value` matches no option. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /**
   * "pill" = filter-bar pill (tinted when `active`); "field" = small inline control;
   * "form" = full-width 44px form field; "row" = right-aligned value in a grouped settings row.
   */
  variant?: "pill" | "field" | "form" | "row";
  /** "form" only: "md" = 44px, 17px text (forms); "sm" = 36px, 15px text (dense cards). */
  size?: "sm" | "md";
  /** Pill only: show the tinted "filter is on" look. Default: `value !== ""`. */
  active?: boolean;
  disabled?: boolean;
  /** Search box on top of the list. Default: on from `SEARCH_THRESHOLD` options. */
  searchable?: boolean;
  /** "auto" = bottom sheet on phones (< 768px), anchored popover elsewhere. */
  presentation?: "auto" | "popover" | "sheet";
  /** Trigger id, so a visible `<label htmlFor>` can point at it. */
  id?: string;
  /** Form field name: a hidden input carries `value` when the select sits in a `<form>`. */
  name?: string;
  required?: boolean;
  invalid?: boolean;
  /** Id(s) of hint / error text for the trigger. */
  describedBy?: string;
  className?: string;
  triggerClassName?: string;
}

/** Label with the matched characters marked. */
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const marked = new Set(indices);
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  // By code point, so a mark never splits an emoji (flags are two surrogate pairs).
  for (const char of text) {
    const hit = marked.has(i);
    i += char.length;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += char;
    else parts.push({ text: char, hit });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-tint-soft text-tint-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Our own select (never the browser's `<select>` and its first-letter type-ahead): the whole list
 * is in the browser and ranked as you type — accents ignored ("viet" = "Việt"), aliases and codes
 * searched, matched letters highlighted, best matches first (see `fuzzy.ts`).
 *
 * Keyboard: ↓ / ↑ / Enter / Space or typing on the trigger opens it; ↑ ↓ PageUp PageDown Home End
 * move, Enter picks, Esc closes, Tab leaves. Short lists (< `SEARCH_THRESHOLD`) have no search box
 * and jump by typed letters instead. ARIA select-only combobox (the trigger) + listbox, the active
 * row via `aria-activedescendant`. Long lists render only the rows in view. On phones it opens as
 * a bottom sheet with the search on top — no native picker.
 */
export function FuzzySelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  variant = "field",
  size = "md",
  active,
  disabled = false,
  searchable,
  presentation = "auto",
  id,
  name,
  required,
  invalid,
  describedBy,
  className,
  triggerClassName,
}: FuzzySelectProps) {
  const strings = useUiStrings();
  placeholder ??= strings.select;
  searchPlaceholder ??= strings.searchEllipsis;
  emptyLabel ??= strings.noMatches;
  const withSearch = searchable ?? options.length >= SEARCH_THRESHOLD;
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const asSheet = presentation === "sheet" || (presentation === "auto" && phone);
  const row = asSheet ? SHEET_ROW : ROW;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(LIST_HEIGHT);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const selected = options.find((o) => o.value === value);
  const results: FuzzyResult<SelectOption>[] = useMemo(
    () =>
      fuzzyRank(options, query, (o) => [
        o.label,
        ...(typeof o.keywords === "string" ? [o.keywords] : (o.keywords ?? [])),
      ]),
    [options, query],
  );

  // Outside click closes the popover (the sheet has its own scrim).
  useEffect(() => {
    if (!open || asSheet) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, asSheet]);

  // On open: focus the search (or the list) and bring the chosen row into view. Runs after the
  // sheet's own focus-first effect, so it wins.
  useEffect(() => {
    if (!open) return;
    const focus = () => (withSearch ? inputRef.current : listRef.current)?.focus({ preventScroll: true });
    focus();
    // The popover is `visibility: hidden` until it has measured its position, and hidden elements
    // can't take focus: try again once it is shown.
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [open, withSearch]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el?.clientHeight) setViewport(el.clientHeight);
  }, [open, asSheet]);

  function scrollToRow(i: number, center = false) {
    const el = scrollRef.current;
    if (!el) return;
    const height = el.clientHeight || viewport;
    const top = i * row;
    let next = el.scrollTop;
    if (center) next = Math.max(0, top - height / 2 + row / 2);
    else if (top < next) next = top;
    else if (top + row > next + height) next = top + row - height;
    if (next !== el.scrollTop) el.scrollTop = next;
    setScrollTop(next);
  }

  function moveTo(i: number) {
    if (!results.length) return;
    const next = Math.max(0, Math.min(i, results.length - 1));
    setCursor(next);
    scrollToRow(next);
  }

  function openList(seed = "") {
    if (disabled) return;
    setQuery(seed);
    const idx = seed ? 0 : Math.max(0, options.findIndex((o) => o.value === value));
    setCursor(idx);
    setScrollTop(0);
    setOpen(true);
    // The list mounts this frame: centre the chosen row once it has a size.
    requestAnimationFrame(() => scrollToRow(idx, true));
  }

  function close(refocus = true) {
    setOpen(false);
    if (!refocus) return;
    triggerRef.current?.focus();
    // The sheet hands focus back to whatever was focused when it opened (on iOS a tapped button
    // isn't focused): claim it again once the sheet has unmounted.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function pick(option: SelectOption | undefined) {
    if (!option) return;
    onChange(option.value);
    close();
  }

  /** No search box: typed letters jump to the next row starting with them (like a native select). */
  function typeAhead(key: string) {
    const now = Date.now();
    const t = typeahead.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const needle = normalize(t.text);
    const n = results.length;
    const start = t.text.length === 1 ? cursor + 1 : cursor;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (normalize(results[i].item.label).startsWith(needle)) return moveTo(i);
    }
  }

  function onListKey(e: KeyboardEvent<HTMLElement>) {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight || viewport) / row) - 1);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return moveTo(cursor + 1);
      case "ArrowUp":
        e.preventDefault();
        return moveTo(cursor - 1);
      case "PageDown":
        e.preventDefault();
        return moveTo(cursor + page);
      case "PageUp":
        e.preventDefault();
        return moveTo(cursor - page);
      case "Home":
        e.preventDefault();
        return moveTo(0);
      case "End":
        e.preventDefault();
        return moveTo(results.length - 1);
      case "Enter":
        e.preventDefault();
        return pick(results[cursor]?.item);
      case "Escape":
        // preventDefault tells a surrounding Sheet the key is handled (it won't close twice).
        e.preventDefault();
        e.stopPropagation();
        return close();
      case "Tab":
        return close(false);
      default:
        if (!withSearch) {
          if (e.key === " ") {
            e.preventDefault();
            return pick(results[cursor]?.item);
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeAhead(e.key);
        }
    }
  }

  const isActive = active ?? value !== "";
  const triggerStyle = {
    pill: cx(
      "inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-full border pr-3 pl-3.5 text-subheadline font-medium transition-colors duration-150 focus-ring",
      isActive
        ? "border-tint/40 bg-tint-soft text-tint-ink"
        : "border-separator bg-background text-label hover:bg-fill-tertiary",
    ),
    field:
      "inline-flex h-8 max-w-[18rem] items-center gap-1.5 rounded-control-sm bg-fill-tertiary pr-2 pl-2.5 text-subheadline text-label hover:bg-fill-secondary focus-ring",
    form: cx(
      "flex w-full items-center gap-2 rounded-control border bg-background text-left text-label focus-ring",
      size === "sm" ? "h-9 px-2 text-subheadline" : "h-11 px-3 text-body",
      invalid ? "border-danger" : "border-control-border",
    ),
    row: "inline-flex min-h-11 max-w-full items-center justify-end gap-1.5 rounded-control-sm text-right text-body text-label-secondary focus-ring",
  }[variant];

  // Only the rows in view (plus a margin) for long lists; every row otherwise.
  const total = results.length;
  const virtual = total >= VIRTUAL_FROM;
  const first = virtual ? Math.max(0, Math.floor(scrollTop / row) - OVERSCAN) : 0;
  const last = virtual ? Math.min(total, Math.ceil((scrollTop + viewport) / row) + OVERSCAN) : total;

  const body = (
    <>
      {withSearch ? (
        <div className={cx("relative flex items-center", asSheet && "mb-2")}>
          <SearchIcon size={asSheet ? 17 : 15} aria-hidden className="pointer-events-none absolute left-2.5 text-label-tertiary" />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={`${strings.search} ${label.toLowerCase()}`}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={total ? optionId(cursor) : undefined}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
              setScrollTop(0);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            onKeyDown={onListKey}
            className={cx(
              "w-full rounded-control bg-fill-tertiary pr-2 text-label placeholder:text-label-tertiary focus:ring-2 focus:ring-tint focus:outline-none",
              // 17px in the sheet: iOS zooms into inputs under 16px.
              asSheet ? "h-11 pl-9 text-body" : "h-9 pl-8 text-subheadline",
            )}
          />
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className={cx(
          "overflow-y-auto overscroll-contain",
          withSearch && !asSheet && "mt-1.5",
          asSheet ? "max-h-[min(60dvh,30rem)]" : "max-h-72",
        )}
      >
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={withSearch ? undefined : -1}
          aria-activedescendant={!withSearch && total ? optionId(cursor) : undefined}
          onKeyDown={withSearch ? undefined : onListKey}
          className="relative focus:outline-none"
          style={{ height: total * row }}
        >
          {results.slice(first, last).map(({ item: o, indices }, k) => {
            const i = first + k;
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                aria-setsize={total}
                aria-posinset={i + 1}
                onPointerMove={() => i !== cursor && setCursor(i)}
                // Keep focus in the search box while clicking.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                style={{ top: i * row, height: row }}
                className={cx(
                  "absolute inset-x-0 flex cursor-pointer items-center gap-2 rounded-control px-2.5",
                  asSheet ? "text-body" : "text-subheadline",
                  i === cursor ? "bg-fill-tertiary" : "",
                  isSelected ? "font-semibold text-tint-ink" : "text-label",
                )}
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">
                  <Highlight text={o.label} indices={indices} />
                </span>
                {o.hint ? <span className="shrink-0 text-footnote text-label-tertiary tabular-nums">{o.hint}</span> : null}
                {isSelected ? <CheckIcon size={14} strokeWidth={2.5} aria-hidden className="shrink-0" /> : null}
              </li>
            );
          })}
        </ul>
        {total === 0 ? <p className="px-3 py-2 text-subheadline text-label-secondary">{emptyLabel}</p> : null}
      </div>
    </>
  );

  return (
    <div ref={rootRef} className={cx("relative inline-flex", variant === "form" && "flex w-full", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          const printable = e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
          if (open) {
            // Fast typing can land here before focus has moved into the search box: keep it.
            if (withSearch && printable) {
              e.preventDefault();
              setQuery((q) => q + e.key);
              setCursor(0);
              inputRef.current?.focus();
            } else onListKey(e);
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          } else if (withSearch && printable) {
            // Typing on the closed select starts a search with that letter.
            e.preventDefault();
            openList(e.key);
          }
        }}
        className={cx(triggerStyle, "disabled:opacity-60", triggerClassName)}
      >
        {selected?.icon}
        <span className={cx("min-w-0 truncate", variant === "form" && "flex-1", !selected && variant !== "pill" && "text-label-tertiary")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          size={14}
          strokeWidth={2.25}
          aria-hidden
          className={cx(
            "shrink-0 transition-transform duration-200",
            open && "rotate-180",
            isActive && variant === "pill" ? "text-tint-ink" : "text-label-tertiary",
          )}
        />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {asSheet ? (
        <Sheet open={open} onClose={() => close()} title={label} closeLabel={strings.close}>
          {body}
        </Sheet>
      ) : (
        <FloatingPanel
          anchorRef={triggerRef}
          open={open}
          panelRef={panelRef}
          className={cx(
            "rounded-[18px] border border-separator bg-background p-1.5 shadow-overlay",
            variant === "form" ? "w-[min(24rem,calc(100vw-1rem))]" : "w-72",
          )}
        >
          {body}
        </FloatingPanel>
      )}
    </div>
  );
}
