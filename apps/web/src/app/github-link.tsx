"use client";

import { cx } from "@ujc/ui";
import { useTranslation } from "react-i18next";
import { REPO_URL } from "@/lib/site";

/** Below this the count reads as "nobody uses it", so only the GitHub mark shows. */
const SHOW_STARS_FROM = 100;
const STARS = Number(process.env.NEXT_PUBLIC_GITHUB_STARS ?? 0) || 0;

function compact(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Top-right link to the public repo; the star count appears once it passes 100 (read at build). */
export function GitHubLink({ className }: { className?: string }) {
  const { t, i18n } = useTranslation("common");
  const showStars = STARS >= SHOW_STARS_FROM;
  const label = showStars ? t("github.labelStars", { count: STARS }) : t("github.label");
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-tertiary px-2.5 text-footnote font-semibold text-label transition-colors duration-150 hover:bg-fill-secondary focus-ring",
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
      </svg>
      {showStars ? (
        <span className="tabular-nums" aria-hidden>
          ★ {compact(STARS, i18n.language)}
        </span>
      ) : null}
    </a>
  );
}
