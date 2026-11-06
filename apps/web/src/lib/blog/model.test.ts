import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  articlesForTopic,
  attributionText,
  cleanBlocks,
  findArticle,
  formatDate,
  jsonLdString,
  parseSnapshot,
  postCiting,
  postJsonLd,
  rssXml,
  safeUrl,
  sitemapXml,
} from "./model";
import { staticSlugs, PLACEHOLDER_SLUG } from "@/app/blog/static-params";

const fullArticle = {
  id: 1,
  source: "conversation-labour-market",
  sourceName: "The Conversation",
  sourceUrl: "https://theconversation.com/topics/labour-market-2562",
  url: "https://theconversation.com/unemployment-1001",
  title: "Unemployment <rises>",
  author: "Jane Economist, Example University",
  excerpt: "Unemployment ticked up.",
  publishedAt: "2026-11-05T10:00:00.000Z",
  firstSeenAt: "2026-11-05T11:00:00.000Z",
  topics: ["labour-market"],
  mode: "full",
  slug: "unemployment-rises-abc123",
  licenceName: "CC BY-ND 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-nd/4.0/",
  body: [{ type: "p", inline: [{ text: "Body." }] }],
  pixelUrl: "https://counter.theconversation.com/content/1001/count.gif",
};

const excerptArticle = {
  ...fullArticle,
  id: 2,
  source: "ere",
  sourceName: "ERE",
  url: "https://www.ere.net/articles/x",
  title: "Recruiting news",
  author: null,
  topics: ["hiring"],
  mode: "excerpt",
  slug: null,
  licenceName: null,
  licenceUrl: null,
  body: null,
  pixelUrl: null,
};

const post = {
  slug: "hiring-career-trends-2026-11-06",
  title: "Hiring & career trends roundup — 6 November 2026",
  description: "2 articles",
  intro: "Intro one.\n\nIntro two.",
  sections: [
    { topic: "hiring", commentary: "c", articleIds: [2] },
    { topic: "labour-market", commentary: "c", articleIds: [1, 999] },
  ],
  relatedJobs: [{ id: 7, title: "Recruiter", company: "Acme", location: null, remote: true, topic: "hiring" }],
  topics: ["hiring", "labour-market"],
  publishedAt: "2026-11-06T22:00:00.000Z",
  updatedAt: "2026-11-06T22:00:00.000Z",
};

const raw = { generatedAt: "2026-11-06T22:05:00.000Z", posts: [post], articles: [fullArticle, excerptArticle] };

describe("safeUrl", () => {
  it("allows http(s) only", () => {
    expect(safeUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});

describe("parseSnapshot", () => {
  it("keeps valid posts and articles and drops dangling article ids", () => {
    const snap = parseSnapshot(raw);
    expect(snap.posts).toHaveLength(1);
    expect(snap.posts[0].sections[1].articleIds).toEqual([1]);
    expect(snap.articles.map((a) => a.mode)).toEqual(["full", "excerpt"]);
  });

  it("drops articles with unsafe urls and posts with bad slugs", () => {
    const snap = parseSnapshot({
      posts: [{ ...post, slug: "../etc/passwd" }],
      articles: [{ ...excerptArticle, url: "javascript:alert(1)" }],
    });
    expect(snap.posts).toHaveLength(0);
    expect(snap.articles).toHaveLength(0);
  });

  it("downgrades a full article missing its licence, slug or body to excerpt", () => {
    for (const patch of [{ licenceUrl: null }, { licenceName: "" }, { slug: "Bad Slug" }, { body: [] }]) {
      const [a] = parseSnapshot({ posts: [], articles: [{ ...fullArticle, ...patch }] }).articles;
      expect(a.mode).toBe("excerpt");
      expect(a.body).toBeNull();
      expect(a.slug).toBeNull();
      expect(a.pixelUrl).toBeNull();
    }
  });

  it("returns an empty snapshot for garbage", () => {
    expect(parseSnapshot(null).posts).toEqual([]);
    expect(parseSnapshot("x").articles).toEqual([]);
  });
});

describe("cleanBlocks", () => {
  it("drops unknown block types and unsafe hrefs, keeps marks", () => {
    const blocks = cleanBlocks([
      { type: "script", text: "alert(1)" },
      { type: "html", html: "<b>x</b>" },
      { type: "p", inline: [{ text: "a", href: "javascript:x", bold: true, onclick: "x" }] },
      { type: "h", level: 9, inline: [{ text: "H" }] },
      { type: "ul", items: [[{ text: "i" }], []] },
      { type: "pre", text: "<code>" },
      { type: "hr" },
    ]);
    expect(blocks).toEqual([
      { type: "p", inline: [{ text: "a", bold: true }] },
      { type: "h", level: 2, inline: [{ text: "H" }] },
      { type: "ul", items: [[{ text: "i" }]] },
      { type: "pre", text: "<code>" },
      { type: "hr" },
    ]);
  });
});

describe("lookups", () => {
  const snap = parseSnapshot(raw);
  it("finds republished articles only by slug", () => {
    expect(findArticle(snap, "unemployment-rises-abc123")?.id).toBe(1);
    expect(findArticle(snap, "recruiting-news")).toBeUndefined();
  });
  it("finds the roundup citing an article and topic reading", () => {
    expect(postCiting(snap, 2)?.slug).toBe(post.slug);
    expect(articlesForTopic(snap, "hiring").map((a) => a.id)).toEqual([2]);
  });
});

describe("attribution and structured data", () => {
  const snap = parseSnapshot(raw);
  const full = snap.articles[0];
  it("credits title, author, publisher and licence", () => {
    expect(attributionText(full)).toBe(
      "“Unemployment <rises>” by Jane Economist, Example University, originally published by The Conversation, licensed under CC BY-ND 4.0.",
    );
  });
  it("marks a republished article as based on the original, with its licence", () => {
    const graph = articleJsonLd(full)["@graph"] as Array<Record<string, unknown>>;
    expect(graph[0]).toMatchObject({ "@type": "Article", isBasedOn: full.url, license: full.licenceUrl });
  });
  it("cites every article in a roundup", () => {
    const graph = postJsonLd(snap.posts[0], snap.articles)["@graph"] as Array<Record<string, unknown>>;
    expect(graph[0]["@type"]).toBe("BlogPosting");
    expect((graph[0].citation as unknown[]).length).toBe(2);
    expect(graph[1]["@type"]).toBe("BreadcrumbList");
  });
  it("escapes < in JSON-LD", () => {
    expect(jsonLdString({ a: "</script><script>" })).not.toContain("<");
  });
});

describe("feeds", () => {
  const snap = parseSnapshot(raw);
  it("rss lists posts with escaped text", () => {
    const xml = rssXml(snap);
    expect(xml).toContain("<title>Hiring &amp; career trends roundup — 6 November 2026</title>");
    expect(xml).toContain("/blog/hiring-career-trends-2026-11-06/</link>");
    expect(xml).not.toMatch(/<rises>/);
  });
  it("sitemap lists blog, topics and posts but not republished copies", () => {
    const xml = sitemapXml(snap);
    expect(xml).toContain("/blog/</loc>");
    expect(xml).toContain("/blog/topics/remote-work/</loc>");
    expect(xml).toContain("/blog/hiring-career-trends-2026-11-06/</loc>");
    expect(xml).not.toContain("/blog/articles/");
  });
});

describe("misc", () => {
  it("formats dates in UTC", () => {
    expect(formatDate("2026-11-06T23:30:00Z")).toBe("6 Nov 2026");
    expect(formatDate(null)).toBe("");
  });
  it("uses a placeholder param when there is nothing to export", () => {
    expect(staticSlugs([])).toEqual([{ slug: PLACEHOLDER_SLUG }]);
    expect(staticSlugs(["a"])).toEqual([{ slug: "a" }]);
  });
});
