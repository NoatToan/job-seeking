import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlogArticle } from "@/lib/blog/types";
import { ArticleBody, ArticleCard, Attribution } from "./blog-ui";

afterEach(cleanup);

const base: BlogArticle = {
  id: 1,
  source: "ere",
  sourceName: "ERE",
  sourceUrl: null,
  url: "https://www.ere.net/articles/x",
  title: "Recruiting news",
  author: "Ada",
  excerpt: "Short excerpt from the feed.",
  publishedAt: "2026-11-05T10:00:00.000Z",
  firstSeenAt: "2026-11-05T10:00:00.000Z",
  topics: ["hiring"],
  mode: "excerpt",
  slug: null,
  licenceName: null,
  licenceUrl: null,
  body: null,
  pixelUrl: null,
};

const full: BlogArticle = {
  ...base,
  sourceName: "The Conversation",
  url: "https://theconversation.com/x-1",
  mode: "full",
  slug: "x-abc123",
  licenceName: "CC BY-ND 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-nd/4.0/",
  body: [{ type: "p", inline: [{ text: "Body" }] }],
};

describe("ArticleCard", () => {
  it("excerpt article: quotes the excerpt and links out to the original (followed)", () => {
    render(<ArticleCard article={base} />);
    expect(screen.getByText("Short excerpt from the feed.").tagName).toBe("BLOCKQUOTE");
    const original = screen.getByRole("link", { name: /Read the original on ERE/ });
    expect(original.getAttribute("href")).toBe(base.url);
    expect(original.getAttribute("rel")).toBe("noopener");
    expect(screen.queryByText("Full article")).toBeNull();
  });

  it("full article: links to our copy and still to the original", () => {
    render(<ArticleCard article={full} />);
    expect(screen.getByRole("link", { name: "Read the full article here" }).getAttribute("href")).toMatch(/^\/blog\/articles\/x-abc123\/?$/); // next/link drops the slash outside a Next build
    expect(screen.getByRole("link", { name: /Read the original on The Conversation/ }).getAttribute("href")).toBe(full.url);
    expect(screen.getByText("Full article")).toBeTruthy();
  });
});

describe("ArticleBody", () => {
  it("renders third-party text as text, never as HTML, and nofollows body links", () => {
    const { container } = render(
      <ArticleBody
        blocks={[
          { type: "p", inline: [{ text: "<img src=x onerror=alert(1)>" }, { text: "link", href: "https://a.test/" }] },
          { type: "h", level: 2, inline: [{ text: "Heading" }] },
          { type: "ul", items: [[{ text: "item", bold: true }]] },
          { type: "p", inline: [{ text: "a" }, { text: "\n" }, { text: "b" }] },
        ]}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(screen.getByRole("link", { name: "link" }).getAttribute("rel")).toBe("nofollow noopener");
    expect(screen.getByRole("heading", { level: 2, name: "Heading" })).toBeTruthy();
    expect(container.querySelector("li strong")?.textContent).toBe("item");
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });
});

describe("Attribution", () => {
  it("names the publisher, date and licence, and links the original", () => {
    render(<Attribution article={full} position="top" />);
    expect(screen.getByText("The Conversation")).toBeTruthy();
    expect(screen.getByRole("link", { name: "CC BY-ND 4.0" }).getAttribute("href")).toBe(full.licenceUrl);
    expect(screen.getByRole("link", { name: /Read the original/ }).getAttribute("href")).toBe(full.url);
  });

  it("bottom credit line follows the licence's attribution form", () => {
    render(<Attribution article={full} position="bottom" />);
    expect(
      screen.getByText("“Recruiting news” by Ada, originally published by The Conversation, licensed under CC BY-ND 4.0."),
    ).toBeTruthy();
  });
});
