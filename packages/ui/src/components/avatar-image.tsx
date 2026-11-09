"use client";

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/** The image part of `Avatar` (a client island, so `Avatar` stays usable in server components):
 * shows `fallback` (the initials) once the image fails to load (dead link, unknown site). */
export function AvatarImage({
  src,
  alt,
  style,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  style: CSSProperties;
  className: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={style}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={className}
    />
  );
}
