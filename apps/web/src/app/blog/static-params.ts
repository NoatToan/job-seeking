/**
 * `output: "export"` rejects a dynamic route whose generateStaticParams returns no params, which
 * is the case before the first post exists (or in CI without a database). A single placeholder
 * param keeps the build green; that page calls notFound(), and with `dynamicParams = false`
 * nothing else is served.
 */
export const PLACEHOLDER_SLUG = "no-posts-yet";

export function staticSlugs(slugs: string[]): Array<{ slug: string }> {
  return (slugs.length ? slugs : [PLACEHOLDER_SLUG]).map((slug) => ({ slug }));
}
