"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { cx, SparklesIcon } from "@ujc/ui";
import { useLanguage } from "@/lib/i18n/provider";
import { RELEASE_NOTES } from "@/lib/release-notes";
import { formatDay } from "./release-notes-page";

/** "✦ What's new · Nov 7" pill linking to `/release-notes/` (home hero aside). */
export function WhatsNewChip({ className }: { className?: string }) {
  const { t } = useTranslation("releaseNotes");
  const { dateLocale } = useLanguage();
  const latest = RELEASE_NOTES.entries[0];
  if (!latest) return null;
  const date = formatDay(latest.date, dateLocale, false);
  return (
    <Link
      href="/release-notes/"
      aria-label={t("whatsNewLabel", { date: formatDay(latest.date, dateLocale) })}
      className={cx(
        "inline-flex h-9 items-center gap-1.5 rounded-full border border-separator bg-background/80 px-3.5 pointer-coarse:h-11 text-subheadline font-medium text-label transition-colors duration-150 hover:bg-fill-tertiary focus-ring",
        className,
      )}
    >
      <SparklesIcon size={16} className="text-tint" />
      {t("whatsNew")}
      <span className="text-label-tertiary">· {date}</span>
    </Link>
  );
}
