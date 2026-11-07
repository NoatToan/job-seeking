"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { GoogleTagManager } from "@next/third-parties/google";
import { useTranslation } from "react-i18next";
import { Button, Card, Toggle } from "@ujc/ui";
import { clearAnalyticsCookies, consentModeState, CONSENT_COOKIE, readConsent, writeConsent } from "./consent-core";
import type { ConsentChoice } from "./consent-core";

// Client half of cookie consent (hook, banner, settings link); the pure part is ./consent-core.
const listeners = new Set<() => void>();
let cached: { raw: string; choice: ConsentChoice | null } | null = null;
/** "Cookie settings" was clicked: the banner reopens on the detailed view. */
let settingsOpen = false;
/** GTM was injected in this page view; withdrawing consent then needs a reload to unload it. */
let gtmLoaded = false;

function notify() {
  for (const l of listeners) l();
}

function snapshot(): ConsentChoice | null {
  // Same object while the cookie is unchanged (useSyncExternalStore compares by identity).
  const raw = typeof document === "undefined" ? "" : (document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=[^;]*`))?.[0] ?? "");
  if (cached?.raw !== raw) cached = { raw, choice: readConsent() };
  return cached.choice;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The saved choice; null = not asked yet; undefined while prerendering (nothing is known). */
export function useConsent(): ConsentChoice | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

function gtag(...args: unknown[]): void {
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
  if (w.gtag) w.gtag(...args);
  else (w.dataLayer ??= []).push(args);
}

/** Saves the choice, updates Consent Mode, and on withdrawal deletes the analytics cookies. */
export function setConsent(analytics: boolean): void {
  const previous = readConsent();
  writeConsent(analytics);
  gtag("consent", "update", consentModeState(analytics));
  settingsOpen = false;
  if (!analytics) {
    clearAnalyticsCookies();
    if (previous?.analytics && gtmLoaded) {
      // A loaded GTM container can't be unloaded; start a clean page without it.
      window.location.reload();
      return;
    }
  }
  notify();
}

/** Reopens the consent panel so the visitor can review or withdraw their choice. */
export function openCookieSettings(): void {
  settingsOpen = true;
  notify();
}

function useSettingsOpen(): boolean {
  return useSyncExternalStore(subscribe, () => settingsOpen, () => false);
}

/** Text button that reopens the consent panel (privacy page, sources popover). */
export function CookieSettingsButton({ className }: { className?: string }) {
  const { t } = useTranslation("consent");
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      {t("settingsLink")}
    </button>
  );
}

/**
 * Root-layout piece: the consent banner (first visit, or after "Cookie settings") and Google Tag
 * Manager, which is only injected once analytics is granted. No cookie wall: the site works while
 * the banner is open, and nothing optional runs until a choice is made.
 */
export function CookieConsent({ gtmId }: { gtmId: string }) {
  const choice = useConsent();
  const reopened = useSettingsOpen();
  const analytics = Boolean(choice?.analytics && gtmId);
  useEffect(() => {
    if (analytics) gtmLoaded = true;
  }, [analytics]);

  return (
    <>
      {analytics ? <GoogleTagManager gtmId={gtmId} /> : null}
      {choice === null || (choice !== undefined && reopened) ? (
        <ConsentBanner initialAnalytics={choice?.analytics ?? false} detailed={reopened} />
      ) : null}
    </>
  );
}

function ConsentBanner({ initialAnalytics, detailed }: { initialAnalytics: boolean; detailed: boolean }) {
  const { t } = useTranslation("consent");
  const [customize, setCustomize] = useState(detailed);
  const [analytics, setAnalytics] = useState(initialAnalytics);
  const titleId = useId();
  const analyticsId = useId();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Reopened on purpose: move focus to the panel so keyboard and screen-reader users land on it.
    if (detailed) rootRef.current?.focus();
  }, [detailed]);

  return (
    <section
      ref={rootRef}
      role="region"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom))] z-[55] outline-none md:inset-x-auto md:bottom-4 md:left-4 md:w-[28rem]"
    >
      <Card padding="md" className="flex max-h-[70dvh] flex-col gap-3 overflow-y-auto shadow-raised">
        <h2 id={titleId} className="text-headline text-label">
          {t("title")}
        </h2>
        <p className="text-subheadline text-label-secondary">
          {t("body")}{" "}
          <Link href="/privacy/#cookies" className="font-medium text-tint hover:underline focus-ring">
            {t("learnMore")}
          </Link>
        </p>

        {customize ? (
          <ul className="flex flex-col gap-3 hairline-t pt-3">
            <li className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-subheadline font-semibold text-label">{t("necessary.title")}</span>
                <span className="text-footnote text-label-secondary">{t("necessary.description")}</span>
              </div>
              <span className="shrink-0 pt-0.5 text-footnote text-label-tertiary">{t("necessary.alwaysOn")}</span>
            </li>
            <li className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span id={analyticsId} className="text-subheadline font-semibold text-label">
                  {t("analytics.title")}
                </span>
                <span className="text-footnote text-label-secondary">{t("analytics.description")}</span>
              </div>
              <Toggle checked={analytics} onChange={setAnalytics} aria-labelledby={analyticsId} />
            </li>
          </ul>
        ) : null}

        {/* Reject and Accept look the same: refusing must be as easy as agreeing. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="tinted" size="sm" className="flex-1" onClick={() => setConsent(false)}>
            {t("rejectAll")}
          </Button>
          <Button variant="tinted" size="sm" className="flex-1" onClick={() => setConsent(true)}>
            {t("acceptAll")}
          </Button>
          {customize ? (
            <Button variant="filled" size="sm" className="basis-full" onClick={() => setConsent(analytics)}>
              {t("save")}
            </Button>
          ) : (
            <Button variant="plain" size="sm" className="basis-full" onClick={() => setCustomize(true)}>
              {t("customize")}
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
