/**
 * Blog snapshot: the JSON `scripts/export-blog.mjs` writes before `next build` (from the
 * `blog_*` tables, db/migrations/023_blog.sql). Pages read it at build time only; the deployed
 * site has no database access.
 */

/** One run of text inside a block. Rendered as escaped React text; `href` is http(s) only. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

/** Sanitised body of a republished article (apps/crawler/src/job_crawler/blog/body.py). */
export type Block =
  | { type: "p" | "quote"; inline: Span[] }
  | { type: "h"; level: 2 | 3 | 4; inline: Span[] }
  | { type: "ul" | "ol"; items: Span[][] }
  | { type: "pre"; text: string }
  | { type: "hr" };

export type RepublishMode = "full" | "excerpt";

export interface BlogArticle {
  id: number;
  source: string;
  sourceName: string;
  sourceUrl: string | null;
  url: string;
  title: string;
  author: string | null;
  excerpt: string | null;
  publishedAt: string | null;
  firstSeenAt: string;
  topics: string[];
  mode: RepublishMode;
  /** Full mode only: our page is /blog/articles/<slug>/. */
  slug: string | null;
  licenceName: string | null;
  licenceUrl: string | null;
  /** Full mode only. */
  body: Block[] | null;
  /** A page-view counter the licence requires us to keep (The Conversation). */
  pixelUrl: string | null;
}

export interface RelatedJob {
  id: number;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  topic: string;
}

export interface PostSection {
  topic: string;
  commentary: string;
  articleIds: number[];
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  intro: string;
  sections: PostSection[];
  relatedJobs: RelatedJob[];
  topics: string[];
  publishedAt: string;
  updatedAt: string;
}

export interface BlogSnapshot {
  generatedAt: string | null;
  posts: BlogPost[];
  articles: BlogArticle[];
}
