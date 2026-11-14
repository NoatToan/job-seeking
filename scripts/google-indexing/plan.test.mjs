import assert from "node:assert/strict";
import { test } from "node:test";
import { jobSitemapsFromRobots, planNotices, sitemapLocs } from "./plan.mjs";

test("reads locs and the job sitemaps from robots.txt", () => {
  const xml = "<urlset><url><loc>https://s/jobs/a-1/</loc></url><url><loc> https://s/jobs/b-2/?x=1&amp;y=2 </loc></url></urlset>";
  assert.deepEqual(sitemapLocs(xml), ["https://s/jobs/a-1/", "https://s/jobs/b-2/?x=1&y=2"]);
  const robots = "User-Agent: *\nSitemap: https://s/sitemap.xml\nSitemap: https://s/jobs/sitemap/0.xml\nsitemap: https://s/jobs/sitemap/1.xml\n";
  assert.deepEqual(jobSitemapsFromRobots(robots), ["https://s/jobs/sitemap/0.xml", "https://s/jobs/sitemap/1.xml"]);
});

test("withdraws gone pages first, then announces new ones newest first, within quota", () => {
  const notices = new Map([
    ["a", "URL_UPDATED"],
    ["gone", "URL_UPDATED"],
    ["back", "URL_DELETED"],
  ]);
  assert.deepEqual(planNotices(["new1", "a", "back", "new2"], notices, 10), [
    { url: "gone", type: "URL_DELETED" },
    { url: "new1", type: "URL_UPDATED" },
    { url: "back", type: "URL_UPDATED" },
    { url: "new2", type: "URL_UPDATED" },
  ]);
  assert.equal(planNotices(["new1", "a", "back", "new2"], notices, 2).length, 2);
});

test("refuses to act on an empty or collapsed sitemap", () => {
  assert.equal(planNotices([], new Map(), 10), null);
  const many = new Map(Array.from({ length: 10 }, (_, i) => [`u${i}`, "URL_UPDATED"]));
  assert.equal(planNotices(["u1", "u2"], many, 10), null);
  assert.deepEqual(planNotices(["x"], new Map(), 10), [{ url: "x", type: "URL_UPDATED" }]);
});
