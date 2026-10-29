"use client";

import { useEffect, useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";
import { cx } from "../cx";

/* ------------------------------------------------------------------ NavBar */

export interface NavBarProps {
  title: string;
  /** iOS large title that collapses into the inline bar title on scroll. Default true. */
  largeTitle?: boolean;
  /** Left slot (back button). */
  leading?: ReactNode;
  /** Right slot (actions, avatar). */
  trailing?: ReactNode;
  /** Content under the large title, e.g. a SearchField or SegmentedControl. */
  children?: ReactNode;
  className?: string;
}

/**
 * Sticky translucent navigation bar. With `largeTitle`, the page's h1 is shown big under the bar;
 * once it scrolls under the bar the small inline title fades in and the bar gets its material +
 * hairline (exactly like UINavigationBar).
 */
export function NavBar({ title, largeTitle = true, leading, trailing, children, className }: NavBarProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(!largeTitle);

  useEffect(() => {
    if (!largeTitle) return;
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      rootMargin: "-44px 0px 0px 0px",
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [largeTitle]);

  const showBarChrome = collapsed || !largeTitle;
  return (
    <>
      <header
        className={cx(
          "sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-300",
          showBarChrome ? "material-bar hairline-b" : "border-b border-transparent",
          className,
        )}
      >
        <div className="relative mx-auto flex h-11 max-w-5xl items-center gap-1 px-2 sm:px-4">
          <div className="flex min-w-11 flex-1 items-center">{leading}</div>
          {largeTitle ? (
            <p
              aria-hidden
              className={cx(
                "absolute left-1/2 max-w-[60%] -translate-x-1/2 truncate text-headline text-label transition-opacity duration-200",
                collapsed ? "opacity-100" : "opacity-0",
              )}
            >
              {title}
            </p>
          ) : (
            <h1 className="absolute left-1/2 max-w-[60%] -translate-x-1/2 truncate text-headline text-label">{title}</h1>
          )}
          <div className="flex min-w-11 flex-1 items-center justify-end gap-1">{trailing}</div>
        </div>
      </header>
      {largeTitle || children ? (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pt-1 pb-3">
          {largeTitle ? (
            <h1 ref={titleRef} className="text-large-title text-label font-display">
              {title}
            </h1>
          ) : null}
          {children}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ Sidebar + TabBar */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Small count (e.g. new matches). */
  badge?: number;
}

export interface BrandMarkProps {
  name: string;
  className?: string;
}

/** Logo: a sun rising over the horizon, in the tint. "Every search is a new morning." */
export function BrandMark({ name, className }: BrandMarkProps) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="flex size-8 items-center justify-center rounded-control bg-tint text-on-tint shadow-card">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 17a7 7 0 0 1 14 0" />
          <path d="M2.5 20.5h19M12 4.5V7M4.6 9.6l1.7 1.7M19.4 9.6l-1.7 1.7" />
        </svg>
      </span>
      <span className="text-headline text-label">{name}</span>
    </span>
  );
}

export interface SidebarProps {
  items: ReadonlyArray<NavItem>;
  activeKey: string;
  /** Top area (BrandMark). */
  header?: ReactNode;
  /** Bottom area (account row). */
  footer?: ReactNode;
  /** Link component (Next `Link`). Default "a". */
  linkAs?: ElementType;
  label?: string;
  /** Sticky full-height and hidden below md (default). Set false for previews. */
  fixed?: boolean;
  className?: string;
}

/** Desktop sidebar (>= md), macOS source-list style: thick material, tinted selection. */
export function Sidebar({
  items,
  activeKey,
  header,
  footer,
  linkAs: LinkAs = "a",
  label = "Main",
  fixed = true,
  className,
}: SidebarProps) {
  return (
    <aside
      className={cx(
        "w-64 shrink-0 flex-col gap-4 material-thick hairline-r px-3 py-4",
        fixed ? "sticky top-0 hidden h-dvh md:flex" : "flex",
        className,
      )}
    >
      {header ? <div className="px-2 pb-2">{header}</div> : null}
      <nav aria-label={label} className="flex-1">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <li key={item.key}>
                <LinkAs
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-10 items-center gap-3 rounded-control px-3 text-body transition-colors duration-150 focus-ring",
                    active
                      ? "bg-tint-soft font-semibold text-tint-ink"
                      : "text-label hover:bg-fill-tertiary",
                  )}
                >
                  <span aria-hidden className={cx("shrink-0", active ? "text-tint" : "text-label-secondary")}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="min-w-6 rounded-full bg-fill-secondary px-1.5 text-center text-caption font-semibold text-label-secondary tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </LinkAs>
              </li>
            );
          })}
        </ul>
      </nav>
      {footer ? <div className="hairline-t pt-3">{footer}</div> : null}
    </aside>
  );
}

export interface TabBarProps {
  items: ReadonlyArray<NavItem>;
  activeKey: string;
  linkAs?: ElementType;
  label?: string;
  /** Pin to the viewport bottom (default). Set false for previews. */
  fixed?: boolean;
  className?: string;
}

/** Mobile tab bar (< md): translucent, hairline top, icon over label, safe-area aware. Max 5 items. */
export function TabBar({ items, activeKey, linkAs: LinkAs = "a", label = "Main", fixed = true, className }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      className={cx(
        "z-30 material-bar hairline-t pb-[env(safe-area-inset-bottom)]",
        fixed && "fixed inset-x-0 bottom-0 md:hidden",
        className,
      )}
    >
      <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <li key={item.key}>
              <LinkAs
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex h-[52px] flex-col items-center justify-center gap-0.5 text-caption font-medium focus-ring focus-visible:-outline-offset-4",
                  active ? "text-tint" : "text-label-tertiary hover:text-label-secondary",
                )}
              >
                <span aria-hidden className="relative">
                  {item.icon}
                  {item.badge ? (
                    <span className="absolute -top-1 -right-2.5 min-w-4 rounded-full bg-danger px-1 text-center text-micro text-background tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                <span>{item.label}</span>
              </LinkAs>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
