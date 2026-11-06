import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@ujc/ui";
import { loadSnapshot } from "@/lib/blog/data";
import { BLOG_OG_IMAGES, BLOG_DESCRIPTION, BLOG_TITLE, blogJsonLd, fullArticles, topicPath } from "@/lib/blog/model";
import { BLOG_TOPICS } from "@/lib/blog/topics";
import { OPEN_GRAPH } from "@/lib/site";
import { ArticleCard, BlogShell, Breadcrumbs, JsonLd, PostCard } from "./blog-ui";

export const metadata: Metadata = {
  title: BLOG_TITLE,
  description: BLOG_DESCRIPTION,
  alternates: { canonical: "/blog/" },
  openGraph: { ...OPEN_GRAPH, images: BLOG_OG_IMAGES, type: "website", url: "/blog/", title: BLOG_TITLE, description: BLOG_DESCRIPTION },
  twitter: { card: "summary_large_image", images: BLOG_OG_IMAGES, title: BLOG_TITLE, description: BLOG_DESCRIPTION },
};

const LATEST = 12;
// Older roundups stay reachable through topic pages, prev/next links and /sitemap-blog.xml.
const ARCHIVE = 50;

export default function BlogIndexPage() {
  const snapshot = loadSnapshot();
  const latest = snapshot.posts.slice(0, LATEST);
  const archive = snapshot.posts.slice(LATEST, LATEST + ARCHIVE);
  const republished = fullArticles(snapshot).slice(0, 6);

  return (
    <BlogShell>
      <JsonLd data={blogJsonLd(snapshot)} />
      <Breadcrumbs items={[{ name: "Jobs", href: "/" }, { name: "Blog" }]} />
      <header className="flex flex-col gap-2">
        <h1 className="text-title1 text-label">{BLOG_TITLE}</h1>
        <p className="text-body text-label-secondary">{BLOG_DESCRIPTION}</p>
        <p className="text-footnote text-label-secondary">
          <a href="/blog/rss.xml" className="font-medium text-tint hover:underline focus-ring rounded-sm">
            RSS feed
          </a>
        </p>
      </header>

      <nav aria-label="Blog topics" className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">Topics</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {BLOG_TOPICS.map((t) => (
            <li key={t.slug}>
              <Link
                href={topicPath(t.slug)}
                className="flex h-full flex-col rounded-card bg-grouped-secondary px-4 py-3 shadow-card hover:bg-fill-tertiary focus-ring"
              >
                <span className="text-body font-medium text-label">{t.name}</span>
                <span className="text-footnote text-label-secondary">{t.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="latest" className="flex flex-col gap-3">
        <h2 id="latest" className="text-title3 text-label">
          Latest roundups
        </h2>
        {latest.length ? (
          <div className="flex flex-col gap-3">
            {latest.map((post) => (
              <PostCard key={post.slug} post={post} articleCount={post.sections.reduce((n, s) => n + s.articleIds.length, 0)} />
            ))}
          </div>
        ) : (
          <EmptyState
            illustration="search"
            title="No roundups yet"
            message="The first daily roundup of hiring and career news will appear here soon."
          />
        )}
      </section>

      {republished.length ? (
        <section aria-labelledby="republished" className="flex flex-col gap-3">
          <h2 id="republished" className="text-title3 text-label">
            Read in full
          </h2>
          <p className="text-subheadline text-label-secondary">
            Openly licensed articles, republished with credit to their authors and publishers.
          </p>
          <div className="flex flex-col gap-3">
            {republished.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      ) : null}

      {archive.length ? (
        <section aria-labelledby="archive" className="flex flex-col gap-2">
          <h2 id="archive" className="text-title3 text-label">
            Archive
          </h2>
          <ul className="flex flex-col gap-1 text-subheadline">
            {archive.map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}/`} className="text-tint hover:underline focus-ring rounded-sm">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </BlogShell>
  );
}
