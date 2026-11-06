import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/blog/data";
import { adjacentPosts, articleById, findPost, formatDate, paragraphs, postJsonLd, postPath, topicPath } from "@/lib/blog/model";
import { topicName } from "@/lib/blog/topics";
import type { BlogArticle } from "@/lib/blog/types";
import { OPEN_GRAPH } from "@/lib/site";
import { ArticleCard, BlogShell, Breadcrumbs, JsonLd, RelatedJobs, TopicChips } from "../blog-ui";
import { PLACEHOLDER_SLUG, staticSlugs } from "../static-params";

// Static export: one page per roundup in the build-time snapshot, nothing else.
export const dynamicParams = false;

export function generateStaticParams() {
  return staticSlugs(loadSnapshot().posts.map((p) => p.slug));
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(loadSnapshot(), slug);
  if (!post) return { title: "Blog", robots: { index: false, follow: true } };
  const url = postPath(post.slug);
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      ...OPEN_GRAPH,
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      tags: post.topics.map(topicName),
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const snapshot = loadSnapshot();
  const post = slug === PLACEHOLDER_SLUG ? undefined : findPost(snapshot, slug);
  if (!post) notFound();

  const byId = articleById(snapshot);
  const sections = post.sections.map((s) => ({
    ...s,
    articles: s.articleIds.map((id) => byId.get(id)).filter((a): a is BlogArticle => a !== undefined),
  }));
  const cited = sections.flatMap((s) => s.articles);
  const { newer, older } = adjacentPosts(snapshot, post.slug);

  return (
    <BlogShell>
      <JsonLd data={postJsonLd(post, cited)} />
      <Breadcrumbs items={[{ name: "Jobs", href: "/" }, { name: "Blog", href: "/blog/" }, { name: post.title }]} />
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-title1 text-label">{post.title}</h1>
          <p className="text-footnote text-label-secondary">
            By the JobSeeking editors · <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time> ·{" "}
            {cited.length} articles from {new Set(cited.map((a) => a.sourceName)).size} publishers
          </p>
          <TopicChips topics={post.topics} />
        </header>

        <div className="flex flex-col gap-3 text-body text-label">
          {paragraphs(post.intro).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        {sections.map((section) => (
          <section key={section.topic} aria-labelledby={`topic-${section.topic}`} className="flex flex-col gap-3">
            <h2 id={`topic-${section.topic}`} className="text-title2 text-label">
              <Link href={topicPath(section.topic)} className="hover:underline focus-ring rounded-sm">
                {topicName(section.topic)}
              </Link>
            </h2>
            {section.commentary ? <p className="text-subheadline text-label-secondary">{section.commentary}</p> : null}
            <div className="flex flex-col gap-3">
              {section.articles.map((a) => (
                <ArticleCard key={a.id} article={a} />
              ))}
            </div>
          </section>
        ))}

        <RelatedJobs jobs={post.relatedJobs} topics={post.topics} />

        <footer className="flex flex-col gap-3 border-t border-separator pt-4 text-footnote text-label-secondary">
          <p>
            Short excerpts are quoted from each publisher&apos;s own feed for commentary, with a link to the original;
            articles marked &ldquo;Full article&rdquo; are republished under the open licence named on their page. All
            rights remain with the original publishers.
          </p>
          <nav aria-label="More roundups" className="flex flex-wrap justify-between gap-2 text-subheadline">
            {older ? (
              <Link href={postPath(older.slug)} className="text-tint hover:underline focus-ring rounded-sm">
                ← {older.title}
              </Link>
            ) : (
              <span />
            )}
            {newer ? (
              <Link href={postPath(newer.slug)} className="text-tint hover:underline focus-ring rounded-sm">
                {newer.title} →
              </Link>
            ) : null}
          </nav>
        </footer>
      </article>
    </BlogShell>
  );
}
