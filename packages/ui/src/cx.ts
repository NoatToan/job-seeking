/** Join class names, skipping falsy values. Tiny stand-in for clsx (no dependency). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
