import type { SimpleIcon } from "simple-icons";
import {
  siAngular,
  siApachekafka,
  siDjango,
  siDocker,
  siDotnet,
  siElixir,
  siExpress,
  siFastapi,
  siFlask,
  siFlutter,
  siGo,
  siGooglecloud,
  siGraphql,
  siJavascript,
  siKotlin,
  siKubernetes,
  siLaravel,
  siMongodb,
  siMysql,
  siNestjs,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siOpenjdk,
  siPhp,
  siPostgresql,
  siPython,
  siReact,
  siRedis,
  siRedux,
  siRuby,
  siRubyonrails,
  siRust,
  siScala,
  siSharp,
  siSpring,
  siSvelte,
  siSwift,
  siTailwindcss,
  siTerraform,
  siTypescript,
  siVuedotjs,
} from "simple-icons";
import { techInfo } from "@ujc/core";
import { cx } from "../cx";

// Brand marks from simple-icons (CC0). AWS and Azure aren't in the set (their trademark
// policies), so they — and any unknown id — fall back to a monogram.
const ICONS: Record<string, SimpleIcon> = {
  react: siReact,
  nextjs: siNextdotjs,
  vue: siVuedotjs,
  nuxt: siNuxt,
  angular: siAngular,
  svelte: siSvelte,
  typescript: siTypescript,
  javascript: siJavascript,
  tailwind: siTailwindcss,
  redux: siRedux,
  "react-native": siReact,
  flutter: siFlutter,
  swift: siSwift,
  kotlin: siKotlin,
  nodejs: siNodedotjs,
  nestjs: siNestjs,
  express: siExpress,
  python: siPython,
  django: siDjango,
  fastapi: siFastapi,
  flask: siFlask,
  java: siOpenjdk,
  spring: siSpring,
  go: siGo,
  rust: siRust,
  ruby: siRuby,
  rails: siRubyonrails,
  php: siPhp,
  laravel: siLaravel,
  dotnet: siDotnet,
  csharp: siSharp,
  elixir: siElixir,
  scala: siScala,
  graphql: siGraphql,
  postgresql: siPostgresql,
  mysql: siMysql,
  mongodb: siMongodb,
  redis: siRedis,
  kafka: siApachekafka,
  gcp: siGooglecloud,
  docker: siDocker,
  kubernetes: siKubernetes,
  terraform: siTerraform,
};

// Near-black/white brand colours vanish on one of the two themes: draw those in the label colour.
const MONO = new Set(["000000", "FFFFFF", "181717"]);

export interface TechIconProps {
  id: string;
  size?: number;
  className?: string;
}

/** A technology's brand mark (e.g. React's atom), labelled for screen readers. */
export function TechIcon({ id, size = 16, className }: TechIconProps) {
  const icon = ICONS[id];
  const { label } = techInfo(id);
  if (!icon) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.45)) }}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-[4px] bg-fill-secondary font-bold uppercase text-label-secondary",
          className,
        )}
      >
        {label.slice(0, 3)}
      </span>
    );
  }
  const color = MONO.has(icon.hex.toUpperCase()) ? "currentColor" : `#${icon.hex}`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={color}
      className={cx("shrink-0 text-label", className)}
    >
      <title>{label}</title>
      <path d={icon.path} />
    </svg>
  );
}

export interface TechStackRowProps {
  ids: readonly string[];
  /** Show at most this many icons, then "+N". */
  max?: number;
  size?: number;
  className?: string;
}

/** Compact row of tech icons for a job row ("React, Next.js, Node.js … +3"). */
export function TechStackRow({ ids, max = 6, size = 15, className }: TechStackRowProps) {
  if (!ids.length) return null;
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  return (
    <span className={cx("inline-flex items-center gap-1.5", className)} aria-label={`Tech: ${ids.map((i) => techInfo(i).label).join(", ")}`}>
      {shown.map((id) => (
        <TechIcon key={id} id={id} size={size} />
      ))}
      {rest > 0 ? <span className="text-caption text-label-secondary">+{rest}</span> : null}
    </span>
  );
}
