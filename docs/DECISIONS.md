# Decisions

Non-obvious decisions that don't fit a single file's comments. The architecture-wide decision
table lives in [`product/ARCHITECTURE.md`](product/ARCHITECTURE.md) §1; this file holds the
details behind individual features.

## Blog (hiring & career trends)

Status: accepted, 2026-11-06. Code: `apps/crawler/src/job_crawler/blog/`, `db/migrations/023_blog.sql`,
`apps/web/src/app/blog/`, `apps/web/scripts/export-blog.mjs`, `.github/workflows/daily-blog.yml`.

### B1. Two republishing modes per source, decided by licence

Every source in `sources.py` has a `republish_mode`, default **`excerpt`**.

| Mode | Used for | What we store and show |
|---|---|---|
| `excerpt` (default) | News outlets and company blogs whose content is all rights reserved (Indeed Hiring Lab, HR Dive, ERE, The Pragmatic Engineer, Stack Overflow Blog, TechCrunch, Remotive) | Title, author, original date, link, and an excerpt of at most 50 words taken from the feed's own summary, as plain text. The article body is never stored, even when the feed carries it (`content:encoded`); we never fetch the article page. |
| `full` | Only sources whose licence allows republication, with the licence URL recorded in `sources.py` after reading it: US federal government works (public domain), Creative Commons CC BY / CC BY-SA / CC BY-ND (verbatim), or an explicit republishing policy | Everything above plus the full text, converted to a sanitised block document, on our page `/blog/articles/<slug>/` with credit, licence and the original link. |

Licences verified (2026-11-06):

- **U.S. Bureau of Labor Statistics** (Employment Situation, JOLTS feeds): "everything that we publish ... is in the public domain"; they ask to be cited as the source. <https://www.bls.gov/opub/copyright-information.htm>. The feed carries the release summary, which is what we republish.
- **The Conversation** (topic feeds: labour market, employment, future of work, remote work, careers, layoffs): CC BY-ND 4.0 under their republishing rules, <https://theconversation.com/republishing-guidelines>. Conditions we implement: credit the author and institution (the feed's author field carries both) and The Conversation with a link to the article; no edits (we keep the text verbatim and only omit images, which the rules allow); their 1x1 page-view counter must be on the page (we render the counter `<img>` from the feed, validated against `counter.theconversation.com/content/<id>/count.gif`, and allow that host in the CSP `img-src`); "you can't systematically republish all of our articles", so we take a handful of topic feeds and at most 3 new items per feed per run. Each item's own `<rights>` must say Creative Commons, otherwise that item drops to excerpt mode.
- **LSE Business Review** (LSE Blogs): CC BY 4.0, <https://blogs.lse.ac.uk/republishing-policy/>. Credit form "Title by Author, originally published on LSE Blogs (URL), licensed under CC BY 4.0", which our credit line follows. Images and third-party embeds are under separate terms, so we drop them. Only items whose headline matches a hiring/careers/labour/remote topic are taken.

A full-mode item also falls back to excerpt mode when its body can't be converted or a required counter pixel is missing. The database enforces the split: a `CHECK` allows a body only on `full` rows, and requires a licence name, licence URL and slug on them.

Removal requests: delete the rows (`DELETE FROM blog_articles WHERE source = '<key>'`; cited roundup items cascade) and set the source to `excerpt` or remove it, then redeploy.

### B2. Canonical of republished copies points to the original

`/blog/articles/<slug>/` sets `<link rel="canonical">` to the **original article URL**. The page is a licensed copy, so the publisher's page should get the ranking credit, and we avoid a duplicate-content penalty for hosting the same text. The copy stays `index, follow` and relies on the canonical alone: Google advises against combining `noindex` with `rel=canonical` (mixed signals; a noindexed page may also stop passing its canonical), so we don't add `noindex`. It is left out of `/sitemap-blog.xml`, because a sitemap should only list canonical URLs. Republished bodies are text only (images and their captions are dropped; their rights are usually separate from the text licence). The pages meant to rank for us are the roundups and topic hubs, which are self-canonical. If a licensor ever asks for something else (e.g. no canonical, or noindex), set it per source.

### B3. Outbound links: citations followed, links inside republished bodies `nofollow`

Our own "Read the original on X" links and article titles are editorial citations of sources we picked and whose host we validate against an allowlist per source, so they are normal followed links (`rel="noopener"`, opening in a new tab; no `noreferrer`, so publishers see the referral). Links inside a republished article body were chosen by the original author, not by us, and we don't vouch for them, so they get `rel="nofollow noopener"`. Adding a `rel` attribute does not change the text, so CC BY-ND's no-derivatives term is respected.

### B4. No LLM

The site owner decided against any AI-written text (no Anthropic API key, no summaries). Roundup intros and per-topic lines are factual templates built from the article list (counts, publishers, themes, the newest headline, how many related jobs we matched), with the opening sentence rotated between three variants, and a post needs at least 8 articles, to keep templated text a small share of each page. The value a roundup adds is curation: grouping by topic, the excerpt and credit for each article, links to full openly licensed copies, and related jobs from our catalogue.

### B5. Rendering and freshness: build-time snapshot, daily rebuild

The web app is a static export with no database access at runtime (ARCHITECTURE.md D1). Blog pages need real HTML for search engines, so they are generated at build time from a snapshot: `apps/web/scripts/export-blog.mjs` runs before `next build`, reads the blog tables in a read-only transaction and writes `apps/web/.blog/snapshot.json` (git-ignored). Blog routes use dynamic segments with `generateStaticParams` and `dynamicParams = false` (an exception to D1's "no dynamic segments", which exists for signed-in, per-user pages).

- No `DATABASE_URL` at build (CI, Docker image): empty snapshot, the build succeeds and the blog shows "no roundups yet". A placeholder param keeps `output: "export"` happy when a dynamic route would otherwise have no params; that page is a 404.
- Blog tables missing: same, with a warning.
- Any other database error fails the build on purpose, so Vercel keeps serving the previous deployment instead of a blog with every post gone.

New content goes live with the next build. `daily-blog.yml` (06:30 Vietnam time, after the 05:00 job crawl so related jobs are fresh) triggers a production rebuild through `vercel-rebuild.yml` when it stored new articles or published a post (`vercel deploy --prod` with the `VERCEL_TOKEN` secret, else a `VERCEL_DEPLOY_HOOK_URL` secret; with neither it skips and content appears on the next ordinary deploy). The rebuild shares the `vercel-prod-deploy` concurrency group with the crawl's rebuild.

We considered committing the snapshot to the repo from the workflow (bot commits on `main` every day, fights branch protection) and fetching it from the API at build time (the API is deployed with the same build, so a fresh deploy would read the previous one); both were worse.

### B6. Sources, politeness and dedupe

One request per feed per day, plus one `robots.txt` per host; 1.5 s between feeds; our usual User-Agent; retries only on 429/5xx with backoff. `robots.txt` is honoured; a missing one (404/410) allows, any other failure (403, 5xx, network) disallows. Article links must be on the source's own hosts. Dedupe: tracking parameters (`utm_*`, `fbclid`, …) and fragments are stripped, then the URL is unique in the table, as is `(source, external_id)`; an article is cited by at most one roundup. A roundup needs at least 8 uncited articles from the last 7 days (fewer roll over to the next day) and takes at most 24, with a per-source cap. Items older than 30 days are ignored (60 for monthly BLS releases, 120 for full-text sources so the blog starts with some reading).

### B7. Sitemap

The blog has its own `/sitemap-blog.xml` (blog index, topic hubs, roundups). It must be listed in the site's sitemap index / `robots.txt` (owned by the per-job SEO pages work), not merged into `sitemap.ts`, to keep the two features independent.
