/**
 * Pure helpers over the blog snapshot: validation, lookups, URLs, JSON-LD, RSS and sitemap XML.
 * No I/O here (see data.ts), so everything is unit-testable.
 */
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { BLOG_TOPICS, topicBySlug, topicName } from "./topics";
import type { BlogArticle, BlogPost, BlogSnapshot, Block, RelatedJob, Span } from "./types";

export const BLOG_TITLE = "Hiring & career trends blog";
export const BLOG_DESCRIPTION =
  "Daily roundups of hiring, labour-market and tech-career news from trusted publishers, openly licensed articles republished in full with credit, and the jobs that go with them.";

/**
 * Link-preview image for blog pages: the site's build-time /opengraph-image (vercel.json serves
 * it as image/png). Set explicitly because a page's own `openGraph` object replaces the
 * inherited one, image included.
 */
export const BLOG_OG_IMAGES = [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${SITE_NAME}: hiring and career trends` }];

export const EMPTY_SNAPSHOT: BlogSnapshot = { generatedAt: null, posts: [], articles: [] };

// ---------------------------------------------------------------------------------------------
// Validation: the snapshot comes from our own DB, but its text originates in third-party feeds,
// so every field is type-checked and every URL must be http(s) before anything renders it.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SPANS = 2000;

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** An ISO date string that actually parses, else null. */
function isoDate(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function cleanSpans(value: unknown): Span[] {
  if (!Array.isArray(value)) return [];
  const out: Span[] = [];
  for (const raw of value.slice(0, MAX_SPANS)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== "string" || !r.text) continue;
    const span: Span = { text: r.text };
    if (r.bold === true) span.bold = true;
    if (r.italic === true) span.italic = true;
    if (r.code === true) span.code = true;
    const href = safeUrl(r.href);
    if (href) span.href = href;
    out.push(span);
  }
  return out;
}

export function cleanBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) return [];
  const out: Block[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    switch (r.type) {
      case "p":
      case "quote": {
        const inline = cleanSpans(r.inline);
        if (inline.length) out.push({ type: r.type, inline });
        break;
      }
      case "h": {
        const inline = cleanSpans(r.inline);
        const level = r.level === 3 || r.level === 4 ? r.level : 2;
        if (inline.length) out.push({ type: "h", level, inline });
        break;
      }
      case "ul":
      case "ol": {
        const items = Array.isArray(r.items) ? r.items.map(cleanSpans).filter((i) => i.length) : [];
        if (items.length) out.push({ type: r.type, items });
        break;
      }
      case "pre":
        if (typeof r.text === "string" && r.text) out.push({ type: "pre", text: r.text });
        break;
      case "hr":
        out.push({ type: "hr" });
        break;
      default:
        break; // unknown block types are dropped
    }
  }
  return out;
}

function cleanArticle(raw: unknown): BlogArticle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = safeUrl(r.url);
  const title = str(r.title);
  // Every cited article lives on another site; our own URL here would make a republished copy
  // canonicalise to itself while claiming to be a copy.
  if (typeof r.id !== "number" || !url || !title || new URL(url).origin === new URL(SITE_URL).origin) return null;
  const slug = typeof r.slug === "string" && SLUG_RE.test(r.slug) ? r.slug : null;
  const licenceUrl = safeUrl(r.licenceUrl);
  const body = cleanBlocks(r.body);
  // Full text renders only with everything the licence needs: a page, the licence and a body.
  const full = r.mode === "full" && slug && licenceUrl && str(r.licenceName) && body.length > 0;
  const pixel = safeUrl(r.pixelUrl);
  return {
    id: r.id,
    source: str(r.source) ?? "unknown",
    sourceName: str(r.sourceName) ?? str(r.source) ?? "the publisher",
    sourceUrl: safeUrl(r.sourceUrl),
    url,
    title,
    author: str(r.author),
    excerpt: str(r.excerpt),
    publishedAt: isoDate(r.publishedAt),
    firstSeenAt: isoDate(r.firstSeenAt) ?? isoDate(r.publishedAt) ?? new Date(0).toISOString(),
    topics: strArray(r.topics),
    mode: full ? "full" : "excerpt",
    slug: full ? slug : null,
    licenceName: full ? str(r.licenceName) : null,
    licenceUrl: full ? licenceUrl : null,
    body: full ? body : null,
    pixelUrl: full && pixel?.startsWith("https://") ? pixel : null,
  };
}

function cleanJob(raw: unknown): RelatedJob | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || !str(r.title) || !str(r.company)) return null;
  return {
    id: r.id,
    title: r.title as string,
    company: r.company as string,
    location: str(r.location),
    remote: r.remote === true,
    topic: str(r.topic) ?? "",
  };
}

function cleanPost(raw: unknown): BlogPost | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = typeof r.slug === "string" && SLUG_RE.test(r.slug) ? r.slug : null;
  const title = str(r.title);
  const publishedAt = isoDate(r.publishedAt);
  if (!slug || !title || !publishedAt) return null;
  const sections = Array.isArray(r.sections)
    ? r.sections.flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const sec = s as Record<string, unknown>;
        const ids = Array.isArray(sec.articleIds) ? sec.articleIds.filter((i): i is number => typeof i === "number") : [];
        return str(sec.topic) && ids.length ? [{ topic: sec.topic as string, commentary: str(sec.commentary) ?? "", articleIds: ids }] : [];
      })
    : [];
  return {
    slug,
    title,
    description: str(r.description) ?? title,
    intro: str(r.intro) ?? "",
    sections,
    relatedJobs: Array.isArray(r.relatedJobs) ? r.relatedJobs.map(cleanJob).filter((j): j is RelatedJob => j !== null) : [],
    topics: strArray(r.topics),
    publishedAt,
    updatedAt: isoDate(r.updatedAt) ?? publishedAt,
  };
}

/** Validates a raw snapshot; malformed entries are dropped, never rendered. */
export function parseSnapshot(raw: unknown): BlogSnapshot {
  if (!raw || typeof raw !== "object") return EMPTY_SNAPSHOT;
  const r = raw as Record<string, unknown>;
  const articles = Array.isArray(r.articles) ? r.articles.map(cleanArticle).filter((a): a is BlogArticle => a !== null) : [];
  const ids = new Set(articles.map((a) => a.id));
  const posts = (Array.isArray(r.posts) ? r.posts.map(cleanPost).filter((p): p is BlogPost => p !== null) : [])
    .map((p) => ({ ...p, sections: p.sections.map((s) => ({ ...s, articleIds: s.articleIds.filter((id) => ids.has(id)) })).filter((s) => s.articleIds.length) }))
    .filter((p) => p.sections.length)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { generatedAt: str(r.generatedAt), posts, articles };
}

// ---------------------------------------------------------------------------------------------
// Lookups and URLs

export const blogPath = () => "/blog/";
export const postPath = (slug: string) => `/blog/${slug}/`;
export const articlePath = (slug: string) => `/blog/articles/${slug}/`;
export const topicPath = (slug: string) => `/blog/topics/${slug}/`;
/** Job detail page in the catalogue (one place to change if job URLs change). */
export const jobPath = (id: number) => `/jobs/view/?id=${encodeURIComponent(String(id))}`;
export const absolute = (path: string) => `${SITE_URL}${path}`;

export function articleById(snapshot: BlogSnapshot): Map<number, BlogArticle> {
  return new Map(snapshot.articles.map((a) => [a.id, a]));
}

export function fullArticles(snapshot: BlogSnapshot): BlogArticle[] {
  return snapshot.articles.filter((a) => a.mode === "full").sort(byDateDesc);
}

export function findPost(snapshot: BlogSnapshot, slug: string): BlogPost | undefined {
  return snapshot.posts.find((p) => p.slug === slug);
}

export function findArticle(snapshot: BlogSnapshot, slug: string): BlogArticle | undefined {
  return snapshot.articles.find((a) => a.mode === "full" && a.slug === slug);
}

/** The roundup that cites an article, if any. */
export function postCiting(snapshot: BlogSnapshot, articleId: number): BlogPost | undefined {
  return snapshot.posts.find((p) => p.sections.some((s) => s.articleIds.includes(articleId)));
}

export function postsForTopic(snapshot: BlogSnapshot, topic: string): BlogPost[] {
  return snapshot.posts.filter((p) => p.topics.includes(topic));
}

/** Articles on a topic that are reachable on our site (cited by a post or republished). */
export function articlesForTopic(snapshot: BlogSnapshot, topic: string, limit = 30): BlogArticle[] {
  const cited = new Set(snapshot.posts.flatMap((p) => p.sections.flatMap((s) => s.articleIds)));
  return snapshot.articles
    .filter((a) => a.topics.includes(topic) && (a.mode === "full" || cited.has(a.id)))
    .sort(byDateDesc)
    .slice(0, limit);
}

/** Newer and older roundups around `slug` (snapshot.posts is newest first). */
export function adjacentPosts(snapshot: BlogSnapshot, slug: string): { newer?: BlogPost; older?: BlogPost } {
  const i = snapshot.posts.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { newer: snapshot.posts[i - 1], older: snapshot.posts[i + 1] };
}

export function articleDate(a: BlogArticle): string {
  return a.publishedAt ?? a.firstSeenAt;
}

function byDateDesc(a: BlogArticle, b: BlogArticle): number {
  return articleDate(b).localeCompare(articleDate(a));
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "6 Nov 2026" (UTC, so the static HTML is the same wherever it is built). */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DATE_FMT.format(d);
}

/** Paragraphs of our own plain text (blank-line separated). */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** One-line credit, in the form CC licences and LSE's policy ask for. */
export function attributionText(a: BlogArticle): string {
  const by = a.author ? ` by ${a.author}` : "";
  const licence = a.licenceName ? `, licensed under ${a.licenceName}` : "";
  return `“${a.title}”${by}, originally published by ${a.sourceName}${licence}.`;
}

// ---------------------------------------------------------------------------------------------
// Structured data

const PUBLISHER = { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: SITE_NAME, url: `${SITE_URL}/` };

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: absolute(item.path) })),
  };
}

function citation(a: BlogArticle): Record<string, unknown> {
  return {
    "@type": "CreativeWork",
    name: a.title,
    url: a.url,
    ...(a.author ? { author: { "@type": "Person", name: a.author } } : {}),
    publisher: { "@type": "Organization", name: a.sourceName },
    ...(a.publishedAt ? { datePublished: a.publishedAt } : {}),
  };
}

export function postJsonLd(post: BlogPost, articles: BlogArticle[]): Record<string, unknown> {
  const url = absolute(postPath(post.slug));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#post`,
        mainEntityOfPage: url,
        url,
        headline: post.title,
        description: post.description,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        inLanguage: "en",
        author: PUBLISHER,
        publisher: PUBLISHER,
        about: post.topics.map((t) => ({ "@type": "Thing", name: topicName(t) })),
        citation: articles.map(citation),
        isPartOf: { "@type": "Blog", "@id": `${absolute(blogPath())}#blog` },
      },
      breadcrumbJsonLd([
        { name: "Jobs", path: "/" },
        { name: "Blog", path: blogPath() },
        { name: post.title, path: postPath(post.slug) },
      ]),
    ],
  };
}

/** A republished article: credited to its author and publisher, `isBasedOn` the original. */
export function articleJsonLd(a: BlogArticle): Record<string, unknown> {
  const url = absolute(articlePath(a.slug ?? ""));
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        url,
        headline: a.title,
        ...(a.excerpt ? { description: a.excerpt } : {}),
        ...(a.publishedAt ? { datePublished: a.publishedAt } : {}),
        inLanguage: "en",
        author: a.author ? { "@type": "Person", name: a.author } : { "@type": "Organization", name: a.sourceName },
        publisher: { "@type": "Organization", name: a.sourceName, ...(a.sourceUrl ? { url: a.sourceUrl } : {}) },
        isBasedOn: a.url,
        ...(a.licenceUrl ? { license: a.licenceUrl } : {}),
      },
      breadcrumbJsonLd([
        { name: "Jobs", path: "/" },
        { name: "Blog", path: blogPath() },
        { name: a.title, path: articlePath(a.slug ?? "") },
      ]),
    ],
  };
}

export function blogJsonLd(snapshot: BlogSnapshot): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${absolute(blogPath())}#blog`,
        url: absolute(blogPath()),
        name: `${BLOG_TITLE} · ${SITE_NAME}`,
        description: BLOG_DESCRIPTION,
        inLanguage: "en",
        publisher: PUBLISHER,
        blogPost: snapshot.posts.slice(0, 20).map((p) => ({
          "@type": "BlogPosting",
          headline: p.title,
          url: absolute(postPath(p.slug)),
          datePublished: p.publishedAt,
        })),
      },
      breadcrumbJsonLd([
        { name: "Jobs", path: "/" },
        { name: "Blog", path: blogPath() },
      ]),
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so it can't close the tag. */
export function jsonLdString(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------------------------------------
// Feeds

export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RSS 2.0 of our own roundup posts (republished articles keep their own publishers' feeds). */
export function rssXml(snapshot: BlogSnapshot, limit = 30): string {
  const items = snapshot.posts.slice(0, limit).map((p) => {
    const url = absolute(postPath(p.slug));
    return [
      "<item>",
      `<title>${escapeXml(p.title)}</title>`,
      `<link>${escapeXml(url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
      `<description>${escapeXml(p.description)}</description>`,
      ...p.topics.map((t) => `<category>${escapeXml(topicName(t))}</category>`),
      "</item>",
    ].join("");
  });
  const updated = snapshot.posts[0]?.publishedAt ?? snapshot.generatedAt;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${escapeXml(`${BLOG_TITLE} · ${SITE_NAME}`)}</title>`,
    `<link>${escapeXml(absolute(blogPath()))}</link>`,
    `<atom:link href="${escapeXml(absolute("/blog/rss.xml"))}" rel="self" type="application/rss+xml"/>`,
    `<description>${escapeXml(BLOG_DESCRIPTION)}</description>`,
    "<language>en</language>",
    ...(updated ? [`<lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>`] : []),
    ...items,
    "</channel>",
    "</rss>",
  ].join("\n");
}

/**
 * Sitemap of the blog's own pages: index, roundups and topic pages. Republished articles are
 * left out on purpose: their canonical URL is the original publisher's page, and a sitemap
 * should only list canonical URLs.
 */
export function sitemapXml(snapshot: BlogSnapshot): string {
  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: absolute(blogPath()), lastmod: snapshot.posts[0]?.publishedAt },
    ...BLOG_TOPICS.map((t) => ({ loc: absolute(topicPath(t.slug)), lastmod: postsForTopic(snapshot, t.slug)[0]?.publishedAt })),
    ...snapshot.posts.map((p) => ({ loc: absolute(postPath(p.slug)), lastmod: p.updatedAt })),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      (u) => `<url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${escapeXml(u.lastmod)}</lastmod>` : ""}</url>`,
    ),
    "</urlset>",
  ].join("\n");
}

export { topicBySlug };
