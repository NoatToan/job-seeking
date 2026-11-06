"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { IconButton, MonitorIcon, MoonIcon, SegmentedControl, SunIcon } from "@ujc/ui";
import { applyTheme, readTheme, THEME_PREFERENCES, THEME_STORAGE_KEY } from "./theme-core";
import type { ThemePreference } from "./theme-core";

// Client half of the appearance setting (hook + controls); the pure part is ./theme-core.
const listeners = new Set<() => void>();
// Fallback when localStorage throws, so the control still reflects the choice.
let memoryPreference: ThemePreference | null = null;

/** Saves (best effort), applies and notifies every `useTheme` subscriber. */
export function setTheme(pref: ThemePreference): void {
  try {
    if (pref === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode / blocked storage: the choice still applies for this page view.
    memoryPreference = pref;
  }
  applyTheme(pref);
  for (const l of listeners) l();
}

function snapshot(): ThemePreference {
  return memoryPreference ?? readTheme();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changed the setting.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    applyTheme(readTheme());
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Current preference and setter. Prerendered as "system"; the real value arrives on hydration. */
export function useTheme(): { theme: ThemePreference; setTheme: (pref: ThemePreference) => void } {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "system" as const);
  return { theme, setTheme };
}

/** Mount-time sync: the init script only sets the class; this also fixes the theme-color metas. */
export function ThemeSync() {
  useEffect(() => applyTheme(snapshot()), []);
  return null;
}

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** Compact top-bar control: one icon button that cycles System → Light → Dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  const { theme, setTheme: set } = useTheme();
  const next = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(theme) + 1) % THEME_PREFERENCES.length];
  const Icon = ICONS[theme];
  return (
    <IconButton
      size="sm"
      variant="gray"
      label={t("theme.toggle", { current: t(`theme.${theme}`), next: t(`theme.${next}`) })}
      icon={<Icon size={17} />}
      onClick={() => set(next)}
      className={className}
    />
  );
}

/** Three-way "System | Light | Dark" picker for the account sheet. */
export function ThemePicker({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  const { theme, setTheme: set } = useTheme();
  return (
    <SegmentedControl
      label={t("theme.label")}
      size="sm"
      value={theme}
      onChange={set}
      options={THEME_PREFERENCES.map((pref) => {
        const Icon = ICONS[pref];
        return {
          value: pref,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <Icon size={15} />
              {t(`theme.${pref}`)}
            </span>
          ),
          ariaLabel: t(`theme.${pref}`),
        };
      })}
      className={className}
    />
  );
}
