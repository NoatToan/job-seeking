import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/blog/data";
import { absolute, articlesForTopic, breadcrumbJsonLd, postsForTopic, topicPath } from "@/lib/blog/model";
import { BLOG_TOPICS, topicBySlug } from "@/lib/blog/topics";
import { OPEN_GRAPH } from "@/lib/site";
import { ArticleCard, BlogShell, Breadcrumbs, JsonLd, PostCard, RelatedJobs } from "../../blog-ui";

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_TOPICS.map((t) => ({ topic: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/topics/[topic]">): Promise<Metadata> {
  const { topic: slug } = await params;
  const topic = topicBySlug(slug);
  if (!topic) return {};
  const title = `${topic.name}: news and analysis`;
  return {
    title,
    description: topic.description,
    alternates: { canonical: topicPath(topic.slug) },
    openGraph: { ...OPEN_GRAPH, url: topicPath(topic.slug), title, description: topic.description },
    twitter: { card: "summary_large_image", title, description: topic.description },
  };
}

export default async function BlogTopicPage({ params }: PageProps<"/blog/topics/[topic]">) {
  const { topic: slug } = await params;
  const topic = topicBySlug(slug);
  if (!topic) notFound();
  const snapshot = loadSnapshot();
  const posts = postsForTopic(snapshot, topic.slug).slice(0, 20);
  const articles = articlesForTopic(snapshot, topic.slug);
  const crumbs = [
    { name: "Jobs", path: "/" },
    { name: "Blog", path: "/blog/" },
    { name: topic.name, path: topicPath(topic.slug) },
  ];

  return (
    <BlogShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "CollectionPage", name: topic.name, description: topic.description, url: absolute(crumbs[2].path) },
            breadcrumbJsonLd(crumbs),
          ],
        }}
      />
      <Breadcrumbs items={[{ name: "Jobs", href: "/" }, { name: "Blog", href: "/blog/" }, { name: topic.name }]} />
      <header className="flex flex-col gap-2">
        <h1 className="text-title1 text-label">{topic.name}</h1>
        <p className="text-body text-label-secondary">{topic.description}</p>
      </header>

      <RelatedJobs jobs={[]} topics={[topic.slug]} />

      {posts.length ? (
        <section aria-labelledby="topic-roundups" className="flex flex-col gap-3">
          <h2 id="topic-roundups" className="text-title3 text-label">
            Roundups covering {topic.name.toLowerCase()}
          </h2>
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} articleCount={p.sections.reduce((n, s) => n + s.articleIds.length, 0)} />
          ))}
        </section>
      ) : null}

      <section aria-labelledby="topic-reading" className="flex flex-col gap-3">
        <h2 id="topic-reading" className="text-title3 text-label">
          Recent reading
        </h2>
        {articles.length ? (
          articles.map((a) => <ArticleCard key={a.id} article={a} />)
        ) : (
          <p className="text-body text-label-secondary">Nothing on this topic yet. New articles arrive every day.</p>
        )}
      </section>
    </BlogShell>
  );
}
