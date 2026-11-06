import type { ReactNode } from "react";
import type { JobLevel } from "@ujc/core";
import { isJobLevel } from "@ujc/core";
import { cx } from "../cx";
import { FlagIcon, SproutIcon, UsersIcon } from "../icons";
import { useUiStrings } from "../strings";

type LevelTone = "success" | "info" | "warning";

/** One look per level, so a level reads the same everywhere: early career is green, the IC
 * ladder is teal with a 1-4 bar meter, management is amber with its own glyph. */
const LEVEL_STYLE: Record<JobLevel, { tone: LevelTone; bars?: number; Icon?: typeof SproutIcon }> = {
  intern: { tone: "success", Icon: SproutIcon },
  junior: { tone: "success", bars: 1 },
  mid: { tone: "info", bars: 2 },
  senior: { tone: "info", bars: 3 },
  lead: { tone: "info", bars: 4 },
  manager: { tone: "warning", Icon: UsersIcon },
  director: { tone: "warning", Icon: FlagIcon },
};

const TONE: Record<LevelTone, string> = {
  success: "bg-success-soft text-success-ink",
  info: "bg-info-soft text-info-ink",
  warning: "bg-warning-soft text-warning-ink",
};

/** Four rising bars, `filled` of them solid: seniority on the individual-contributor ladder. */
export function LevelBars({ filled, size = 12 }: { filled: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden focusable="false" data-bars={filled}>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 3}
          y={9 - i * 2.5}
          width={2}
          height={3 + i * 2.5}
          rx={0.75}
          fill="currentColor"
          opacity={i < filled ? 1 : 0.28}
        />
      ))}
    </svg>
  );
}

export interface LevelBadgeProps {
  level: JobLevel | string | null | undefined;
  /** Where the level came from (`Job.levelSource`): shown as a tooltip. */
  source?: "source" | "title" | "description" | null;
  /** "sm" for job rows, "md" (Badge height) for the job detail. */
  size?: "sm" | "md";
  className?: string;
}

/** Seniority pill: glyph + short label ("Senior"), with an accessible "Level: Senior". */
export function LevelBadge({ level, source, size = "md", className }: LevelBadgeProps): ReactNode {
  const strings = useUiStrings();
  if (!isJobLevel(level)) return null;
  const style = LEVEL_STYLE[level];
  const label = strings.levels.names[level];
  const iconSize = size === "sm" ? 11 : 13;
  const glyph = style.Icon ? (
    <style.Icon size={iconSize} strokeWidth={2} />
  ) : (
    <LevelBars filled={style.bars ?? 0} size={iconSize - 1} />
  );
  return (
    <span
      data-level={level}
      title={source ? `${strings.levels.aria(label)} · ${strings.levels.from[source]}` : undefined}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold",
        size === "sm" ? "h-5 px-1.5 text-micro" : "h-6 px-2.5 text-caption",
        TONE[style.tone],
        className,
      )}
    >
      {glyph}
      <span aria-hidden>{label}</span>
      <span className="sr-only">{strings.levels.aria(label)}</span>
    </span>
  );
}
