"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { SourceInfo } from "@ujc/core";
import { SOURCES, sourceMeta } from "@ujc/core";
import { BrandMark, ChevronDownIcon, cx, FloatingPanel, Sheet } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { AccountMenu, BRAND_NAME } from "@/app/nav";
import { LanguageSwitch, useLanguage } from "@/lib/i18n/provider";
import { usePhoneLayout } from "@/lib/use-phone-layout";

/**
 * Top of the home page (public catalogue and signed-in feed): a warm "sunrise" band with a
 * friendly headline and the search + filters, like the landing of a job site rather than an
 * admin screen. Phones get their own brand + account row here, since the TopNav is desktop-only.
 */
export function HomeHero({
  title,
  subtitle,
  aside,
  compactOnPhones = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right of the headline on wide screens (e.g. a CTA or the sources summary). */
  aside?: ReactNode;
  /** Hide the subtitle on phones (it is only a tagline there). */
  compactOnPhones?: boolean;
  /** Search + filter bar. */
  children?: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <section className="hero-wash hairline-b">
      <div className="flex w-full flex-col gap-3.5 px-4 pt-4 pb-4 sm:px-6 md:pt-5">
        <div className="flex items-center justify-between md:hidden">
          <Link href="/" aria-label={t("brand.homeAriaLabel", { name: BRAND_NAME })} className="rounded-control focus-ring">
            <BrandMark name={BRAND_NAME} />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <AccountMenu />
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h1 className="font-display text-title1 font-bold tracking-[-0.025em] text-label md:text-[2rem] md:leading-tight">
              {title}
            </h1>
            {subtitle ? <div className={cx("mt-1 text-callout text-label-secondary", compactOnPhones && "hidden sm:block")}>{subtitle}</div> : null}
          </div>
          {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

function statusColor(status: SourceInfo["status"]): string {
  if (status === "error") return "bg-danger";
  if (status === "running") return "bg-warning";
  return "bg-success";
}

/**
 * "11 sources · live" pill that opens a small list of every source with its crawl status and job
 * count. Replaces the always-visible "Adzuna ok · Arc ok · …" strip, which read like a monitoring
 * dashboard; the information is one click away and still honest about sources that are down.
 * Phones get the same list in a sheet instead of a popover over the filters.
 */
export function SourcesSummary({ sources }: { sources: SourceInfo[] }) {
  const { t } = useTranslation("home");
  const { dateLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const phone = usePhoneLayout();

  useEffect(() => {
    // The sheet handles its own Esc and outside taps.
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, phone]);

  if (sources.length === 0) return null;
  const down = sources.filter((s) => s.status === "error").length;
  const total = sources.reduce((sum, s) => sum + (s.total || 0), 0);
  const details = (
    <>
      <p className="px-2 pt-1 pb-2 text-footnote text-label-secondary">
        {total
          ? t("sources.summary", { total: total.toLocaleString(dateLocale) })
          : t("sources.summaryNoTotal")}
      </p>
      <ul className="flex flex-col">
        {sources.map((s) => (
          <li key={s.source} className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-subheadline">
            <span aria-hidden className={cx("size-2 shrink-0 rounded-full", statusColor(s.status))} />
            <span className="flex-1 truncate text-label">{sourceMeta(s.source).label}</span>
            <span className="text-footnote text-label-tertiary tabular-nums">
              {s.status === "error"
                ? t("sources.rowPaused")
                : s.status === "running"
                  ? t("sources.rowUpdating")
                  : (s.total || 0).toLocaleString(dateLocale)}
            </span>
          </li>
        ))}
      </ul>
      {/* Attribution (Adzuna's terms ask for a visible "Jobs by Adzuna" link) + privacy, which
          used to sit in the site footer. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 hairline-t px-2 pt-2 pb-1 text-caption text-label-tertiary">
        <a
          href={SOURCES.adzuna.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-control-sm font-medium text-tint hover:underline focus-ring"
        >
          {t("sources.attribution")}
        </a>
        <span aria-hidden>·</span>
        <Link href="/privacy/" className="rounded-control-sm hover:underline focus-ring">
          {t("sources.privacy")}
        </Link>
      </p>
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup={phone ? "dialog" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-separator bg-background/80 px-3.5 text-subheadline font-medium text-label transition-colors duration-150 hover:bg-fill-tertiary focus-ring"
      >
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        {t("sources.count", { count: sources.length })}
        {down ? <span className="text-label-tertiary">· {t("sources.paused", { count: down })}</span> : null}
        <ChevronDownIcon
          size={14}
          strokeWidth={2.25}
          aria-hidden
          className={cx("text-label-tertiary transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {phone ? (
        <Sheet open={open} onClose={() => setOpen(false)} title={t("sources.ariaLabel")}>
          <div id={panelId}>{details}</div>
        </Sheet>
      ) : (
        <FloatingPanel
          anchorRef={triggerRef}
          open={open}
          panelRef={panelRef}
          align="end"
          id={panelId}
          role="status"
          aria-label={t("sources.ariaLabel")}
          className="w-72 rounded-[18px] border border-separator bg-background p-2 shadow-overlay"
        >
          {details}
        </FloatingPanel>
      )}
    </div>
  );
}
