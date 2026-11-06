import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, cx } from "@ujc/ui";
import {
  articleDate,
  articlePath,
  attributionText,
  formatDate,
  jobPath,
  jsonLdString,
  postPath,
  topicPath,
} from "@/lib/blog/model";
import { topicBySlug, topicName } from "@/lib/blog/topics";
import type { BlogArticle, BlogPost, Block, RelatedJob, Span } from "@/lib/blog/types";

/*
 * Server components for the blog (rendered once at build time). Third-party text is only ever
 * rendered as React text nodes; links come from the validated snapshot (http/https only).
 *
 * Outbound links (docs/DECISIONS.md "Blog"): our citations of the original article are normal,
 * followed editorial links (`rel="noopener"`); links *inside* a republished article body are the
 * publisher's, not ours, so they get `nofollow`.
 */

const LINK = "font-medium text-tint hover:underline focus-ring rounded-sm";

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Build-time JSON with `<` escaped, so the payload can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

export function BlogShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">{children}</main>;
}

export function Breadcrumbs({ items }: { items: Array<{ name: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="text-footnote text-label-secondary">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <span aria-hidden="true">›</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-label hover:underline focus-ring rounded-sm">
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-label">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function TopicChips({ topics }: { topics: string[] }) {
  if (!topics.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Topics">
      {topics.map((t) => (
        <li key={t}>
          <Link
            href={topicPath(t)}
            className="inline-flex rounded-full bg-fill-tertiary px-3 py-1 text-footnote font-medium text-label hover:bg-fill-secondary focus-ring"
          >
            {topicName(t)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "Read the original on X" — the prominent citation link, followed. */
export function OriginalLink({ article, className }: { article: BlogArticle; className?: string }) {
  return (
    <a href={article.url} target="_blank" rel="noopener" className={cx(LINK, className)}>
      Read the original on {article.sourceName}
      <span className="sr-only"> (opens in a new tab)</span> ↗
    </a>
  );
}

function byline(article: BlogArticle): string {
  const date = formatDate(articleDate(article));
  return [article.sourceName, article.author, date].filter(Boolean).join(" · ");
}

/** One cited article inside a roundup or topic list. */
export function ArticleCard({ article }: { article: BlogArticle }) {
  const full = article.mode === "full" && article.slug;
  return (
    <Card as="article" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-footnote text-label-secondary">{byline(article)}</p>
        {full ? (
          <Badge tone="success" title={`Republished under ${article.licenceName}`}>
            Full article
          </Badge>
        ) : null}
      </div>
      <h3 className="text-headline text-label">
        {full ? (
          <Link href={articlePath(article.slug!)} className="hover:underline focus-ring rounded-sm">
            {article.title}
          </Link>
        ) : (
          <a href={article.url} target="_blank" rel="noopener" className="hover:underline focus-ring rounded-sm">
            {article.title}
          </a>
        )}
      </h3>
      {article.excerpt ? (
        <blockquote cite={article.url} className="border-l-2 border-separator pl-3 text-subheadline text-label-secondary">
          {article.excerpt}
        </blockquote>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-subheadline">
        {full ? (
          <Link href={articlePath(article.slug!)} className={LINK}>
            Read the full article here
          </Link>
        ) : null}
        <OriginalLink article={article} />
      </p>
    </Card>
  );
}

export function PostCard({ post, articleCount }: { post: BlogPost; articleCount: number }) {
  return (
    <Card as="article" className="flex flex-col gap-1.5">
      <p className="text-footnote text-label-secondary">
        <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time> · {articleCount} articles
      </p>
      <h3 className="text-headline text-label">
        <Link href={postPath(post.slug)} className="hover:underline focus-ring rounded-sm">
          {post.title}
        </Link>
      </h3>
      <p className="text-subheadline text-label-secondary">{post.description}</p>
    </Card>
  );
}

export function RelatedJobs({ jobs, topics }: { jobs: RelatedJob[]; topics: string[] }) {
  const searches = topics.map((t) => topicBySlug(t)).filter((t) => t !== undefined);
  const uniqueSearches = searches.filter((t, i) => searches.findIndex((s) => s.jobsHref === t.jobsHref) === i);
  if (!jobs.length && !uniqueSearches.length) return null;
  return (
    <section aria-labelledby="related-jobs" className="flex flex-col gap-3">
      <h2 id="related-jobs" className="text-title3 text-label">
        Related jobs
      </h2>
      {jobs.length ? (
        <ul className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
          {jobs.map((job) => (
            <li key={job.id} className="border-b border-separator last:border-b-0">
              <Link href={jobPath(job.id)} className="flex flex-col px-4 py-3 hover:bg-fill-tertiary focus-ring">
                <span className="text-body font-medium text-label">{job.title}</span>
                <span className="text-footnote text-label-secondary">
                  {[job.company, job.location, job.remote ? "Remote" : null].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-subheadline">
        {uniqueSearches.map((t) => (
          <Link key={t.slug} href={t.jobsHref} className={LINK}>
            {t.jobsLabel} →
          </Link>
        ))}
      </p>
    </section>
  );
}

function SpanText({ span }: { span: Span }) {
  let node: ReactNode = span.text;
  if (span.code) node = <code className="rounded bg-fill-tertiary px-1 font-mono">{node}</code>;
  if (span.italic) node = <em>{node}</em>;
  if (span.bold) node = <strong>{node}</strong>;
  if (span.href) {
    node = (
      <a href={span.href} target="_blank" rel="nofollow noopener" className="text-tint underline underline-offset-2">
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.text === "\n" ? <br key={i} /> : <SpanText key={i} span={s} />,
      )}
    </>
  );
}

/** Renders a sanitised republished body. No HTML from the source reaches the page. */
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  // The page title is the h1; shift the source's headings so the first level used becomes h2
  // (no skipped levels for screen-reader heading navigation).
  const levels = blocks.flatMap((b) => (b.type === "h" ? [b.level] : []));
  const shift = levels.length ? Math.min(...levels) - 2 : 0;
  return (
    <div className="flex flex-col gap-4 text-body leading-relaxed text-label">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "p":
            return (
              <p key={i}>
                <Inline spans={block.inline} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-separator pl-4 text-label-secondary">
                <Inline spans={block.inline} />
              </blockquote>
            );
          case "h": {
            const level = Math.max(2, block.level - shift);
            const Tag = level === 2 ? "h2" : level === 3 ? "h3" : "h4";
            return (
              <Tag key={i} className={level === 2 ? "pt-2 text-title3" : "pt-1 text-headline"}>
                <Inline spans={block.inline} />
              </Tag>
            );
          }
          case "ul":
          case "ol": {
            const List = block.type;
            return (
              <List key={i} className={cx("flex flex-col gap-1 pl-6", block.type === "ul" ? "list-disc" : "list-decimal")}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline spans={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "pre":
            return (
              <pre key={i} className="overflow-x-auto rounded-control bg-fill-tertiary p-3 font-mono text-footnote">
                {block.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-separator" />;
        }
      })}
    </div>
  );
}

/** Credit box for a republished article: source, author, date, licence and the original. */
export function Attribution({ article, position }: { article: BlogArticle; position: "top" | "bottom" }) {
  return (
    <aside
      aria-label={position === "top" ? "About this article" : "Credit and licence"}
      className="flex flex-col gap-1.5 rounded-card bg-tint-soft px-4 py-3 text-subheadline text-label"
    >
      {position === "top" ? (
        <p>
          Originally published by <strong>{article.sourceName}</strong>
          {article.publishedAt ? (
            <>
              {" "}
              on <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
            </>
          ) : null}
          . Republished here in full under{" "}
          <a href={article.licenceUrl ?? article.url} target="_blank" rel="noopener license" className={LINK}>
            {article.licenceName}
          </a>
          .
        </p>
      ) : (
        <p>{attributionText(article)}</p>
      )}
      <p>
        <OriginalLink article={article} />
      </p>
    </aside>
  );
}
