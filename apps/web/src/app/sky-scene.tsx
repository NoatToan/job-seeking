import { useId } from "react";
import { cx } from "@ujc/ui";
import type { DayPhase } from "@/lib/work-hours";

/**
 * Weather-app style corner scene for a job row: the sky at the time the job's hours fall on the
 * viewer's clock — sun and clouds by day, a low sun at dawn and dusk, moon and stars at night.
 * Decorative only (the fit badge says the same in words). Colours are theme tokens
 * (`--ujc-sky-*` in packages/ui/src/theme.css) so dark mode can tune them.
 */
export function SkyScene({
  phase,
  size = "row",
  className,
}: {
  phase: DayPhase;
  /** `row`: a job list row's corner. `panel`: the job detail header, larger and fading downwards
   * too; `panel-bleed` also reaches over the detail panel's 24px padding into its rounded corner. */
  size?: "row" | "panel" | "panel-bleed";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cx(
        "pointer-events-none absolute -z-10 overflow-hidden",
        size === "row" &&
          "inset-y-0 right-0 w-52 rounded-r-[inherit] [mask-image:linear-gradient(to_left,black_35%,transparent)]",
        size !== "row" &&
          "h-56 w-[26rem] max-w-full [mask-image:radial-gradient(120%_100%_at_100%_0%,black_45%,transparent_80%)]",
        size === "panel" && "top-0 right-0",
        size === "panel-bleed" && "-top-6 -right-6 rounded-tr-[22px]",
        `sky-${phase}`,
        className,
      )}
    >
      <svg
        viewBox="0 0 200 120"
        className={cx("absolute top-0 right-0", size === "row" ? "h-[120px] w-[200px]" : "h-[180px] w-[300px]")}
        fill="none"
      >
        {phase === "day" ? <Day /> : phase === "night" ? <Night /> : <LowSun phase={phase} />}
      </svg>
      {/* Low black scrim over the scene so text on top keeps its contrast. */}
      <div className="absolute inset-0 bg-[var(--ujc-sky-scrim)]" />
    </div>
  );
}

/** A soft cumulus: overlapping circles on a flat base. */
function Cloud({ x, y, scale = 1, fill, opacity = 1 }: { x: number; y: number; scale?: number; fill: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill={fill} opacity={opacity}>
      <circle cx="0" cy="0" r="9" />
      <circle cx="12" cy="-5" r="12" />
      <circle cx="26" cy="0" r="9" />
      <rect x="-9" y="0" width="44" height="9" rx="4.5" />
    </g>
  );
}

function Day() {
  return (
    <>
      <circle cx="166" cy="28" r="30" fill="var(--ujc-sky-sun-glow)" />
      <circle cx="166" cy="28" r="13" fill="var(--ujc-sky-sun)" />
      <Cloud x={120} y={44} fill="var(--ujc-sky-cloud)" opacity={0.95} />
      <Cloud x={160} y={62} scale={0.7} fill="var(--ujc-sky-cloud)" opacity={0.8} />
    </>
  );
}

function LowSun({ phase }: { phase: "dawn" | "dusk" }) {
  const sun = phase === "dawn" ? "var(--ujc-sky-dawn-sun)" : "var(--ujc-sky-dusk-sun)";
  const cloud = phase === "dawn" ? "var(--ujc-sky-dawn-cloud)" : "var(--ujc-sky-dusk-cloud)";
  const clipId = useId();
  return (
    <>
      <defs>
        {/* Everything above the horizon line: the sun is half set (or half risen). */}
        <clipPath id={clipId}>
          <rect width="200" height="58" />
        </clipPath>
      </defs>
      <circle cx="162" cy="58" r="36" fill={sun} opacity="0.2" />
      <circle cx="162" cy="58" r="22" fill={sun} opacity="0.25" />
      <circle cx="162" cy="58" r="14" fill={sun} clipPath={`url(#${clipId})`} />
      {/* Thin haze lines on the horizon. */}
      <rect x="128" y="60" width="72" height="2.5" rx="1.25" fill={sun} opacity="0.55" />
      <rect x="142" y="66" width="48" height="2" rx="1" fill={sun} opacity="0.35" />
      <Cloud x={112} y={30} scale={0.75} fill={cloud} opacity={0.9} />
    </>
  );
}

const STARS: ReadonlyArray<[number, number, number, number]> = [
  // x, y, radius, animation delay (s)
  [120, 18, 1.2, 0],
  [138, 46, 0.9, 1.1],
  [186, 58, 1.1, 0.6],
  [150, 14, 0.8, 1.8],
  [112, 52, 0.7, 2.4],
  [176, 84, 0.8, 1.4],
];

function Night() {
  const maskId = useId();
  return (
    <>
      <defs>
        <mask id={maskId}>
          <rect width="200" height="120" fill="white" />
          <circle cx="172" cy="22" r="12" fill="black" />
        </mask>
      </defs>
      <circle cx="164" cy="30" r="24" fill="var(--ujc-sky-moon-glow)" />
      <circle cx="164" cy="30" r="12" fill="var(--ujc-sky-moon)" mask={`url(#${maskId})`} />
      {STARS.map(([x, y, r, delay]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={r}
          fill="var(--ujc-sky-star)"
          className="animate-twinkle motion-reduce:animate-none"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      {/* One four-point sparkle, like the bright star in Apple Weather's night sky. */}
      <path d="M130 30 l1.2 3.3 3.3 1.2 -3.3 1.2 -1.2 3.3 -1.2 -3.3 -3.3 -1.2 3.3 -1.2z" fill="var(--ujc-sky-star)" />
    </>
  );
}
