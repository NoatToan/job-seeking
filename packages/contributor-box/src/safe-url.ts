/**
 * Returns `value` if it is safe to use as a link `href` (absolute http(s) or a root-relative
 * path), else `null`. The server already rejects anything else; this is the render-time check.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  // `/\host` is treated as protocol-relative by browsers, like `//host`.
  if (value.startsWith("/")) return /^\/[/\\]/.test(value) || /\s/.test(value) ? null : value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
