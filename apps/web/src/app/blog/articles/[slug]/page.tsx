import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/blog/data";
import { BLOG_OG_IMAGES, articleJsonLd, articlePath, findArticle, fullArticles, postCiting, postPath, topicPath } from "@/lib/blog/model";
import { topicName } from "@/lib/blog/topics";
import { OPEN_GRAPH } from "@/lib/site";
import { ArticleBody, Attribution, BlogShell, Breadcrumbs, JsonLd, RelatedJobs, TopicChips } from "../../blog-ui";
import { staticSlugs } from "../../static-params";

export const dynamicParams = false;

export function generateStaticParams() {
  return staticSlugs(fullArticles(loadSnapshot()).map((a) => a.slug!));
}

/**
 * A republished, openly licensed article. `canonical` is the ORIGINAL article's URL
 * (docs/DECISIONS.md "Blog"): this page is a licensed copy, so search engines should credit and
 * rank the publisher's page, and we avoid a duplicate-content penalty. Our own roundup and topic
 * pages are the ones meant to rank.
 */
export async function generateMetadata({ params }: PageProps<"/blog/articles/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle(loadSnapshot(), slug);
  if (!article) return { title: "Blog", robots: { index: false, follow: true } };
  const description = article.excerpt ?? `${article.title}, republished from ${article.sourceName}.`;
  return {
    title: article.title,
    description,
    authors: article.author ? [{ name: article.author }] : undefined,
    alternates: { canonical: article.url },
    openGraph: {
      ...OPEN_GRAPH,
      images: BLOG_OG_IMAGES,
      type: "article",
      url: articlePath(article.slug!),
      title: article.title,
      description,
      publishedTime: article.publishedAt ?? undefined,
      authors: article.author ? [article.author] : undefined,
    },
    twitter: { card: "summary_large_image", images: BLOG_OG_IMAGES, title: article.title, description },
  };
}

export default async function RepublishedArticlePage({ params }: PageProps<"/blog/articles/[slug]">) {
  const { slug } = await params;
  const snapshot = loadSnapshot();
  const article = findArticle(snapshot, slug);
  if (!article || !article.body) notFound();
  const roundup = postCiting(snapshot, article.id);

  return (
    <BlogShell>
      <JsonLd data={articleJsonLd(article)} />
      <Breadcrumbs items={[{ name: "Jobs", href: "/" }, { name: "Blog", href: "/blog/" }, { name: article.title }]} />
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-title1 text-label">{article.title}</h1>
          {article.author ? <p className="text-subheadline text-label-secondary">By {article.author}</p> : null}
          <Attribution article={article} position="top" />
          <TopicChips topics={article.topics} />
        </header>

        <ArticleBody blocks={article.body} />

        <Attribution article={article} position="bottom" />
        {article.pixelUrl ? (
          // The publisher's page-view counter, required by its republishing licence.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.pixelUrl} alt="" width={1} height={1} className="h-px w-px" referrerPolicy="no-referrer-when-downgrade" />
        ) : null}
      </article>

      {roundup ? (
        <p className="text-subheadline text-label-secondary">
          Featured in{" "}
          <Link href={postPath(roundup.slug)} className="font-medium text-tint hover:underline focus-ring rounded-sm">
            {roundup.title}
          </Link>
          .
        </p>
      ) : null}
      {article.topics[0] ? (
        <p className="text-subheadline text-label-secondary">
          More on{" "}
          <Link href={topicPath(article.topics[0])} className="font-medium text-tint hover:underline focus-ring rounded-sm">
            {topicName(article.topics[0])}
          </Link>
          .
        </p>
      ) : null}
      <RelatedJobs jobs={roundup?.relatedJobs ?? []} topics={article.topics} />
    </BlogShell>
  );
}
