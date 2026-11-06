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

## Home hero folds while browsing (2026-11-06)

Tony asked for the "Find a tech job you'll love" block to collapse, either with a toggle or by hiding while the user browses jobs and coming back on hover. Both are in, with the search and filters always visible; only the headline (title, tagline, sources, sign-in CTA) folds.

- **Auto:** scrolling the job list down past 160px folds it; back at the top it unfolds. 160px is more than the headline's own height, so folding it can never scroll a window-scrolled page back to 0 and flicker.
- **Hover peek:** resting the mouse on the hero for 300ms opens it, leaving folds it after 350ms. The delay stops it opening every time the pointer crosses on its way to the filters. Touch never peeks. It stays open while a popover from the headline (the sources list) is open, because that popover is portaled outside the hero.
- **Toggle:** a chevron at the end of the filter row. Folding with it pins the choice (localStorage `ujc:hero-collapsed`), which wins over hover; pressing it again unpins.
- **Phones:** unchanged. Their hero is already compact (brand row and filters, tagline hidden).
- The two-column browser's height is measured in JS; it now also observes the headline, because the shell's `min-h-dvh` keeps `body` the same size while the hero folds.

## Anonymous feedback (2026-11-06)

Tony asked for "Send feedback" to work without signing in, anonymously or under any name. It is
built in contributor-box as an opt-in (`allow_anonymous` / `allowAnonymous`, upstream decision 13)
and turned on here.

- **Create only.** Guests can send a bug, feedback or idea with an optional name (at most 80
  characters). Reading, voting, "my feedback" and deleting still need an account, so nothing
  about a guest's item can be read back.
- **CSRF still applies.** `ujc_csrf` used to be issued only at sign-in, so `GET /api/auth/csrf`
  now issues it to a visitor who has none (an existing cookie is never replaced). The web app
  calls it lazily, right before a guest's first unsafe feedback request.
- **Abuse.** contributor-box rate-limits guests in the database: 5 per visitor key and 60 across
  all guests per hour. The visitor key is an HMAC of the first `X-Forwarded-For` hop with
  `UJC_SECRET_KEY`, so the raw IP is never stored. The generic per-IP limit on unsafe methods and
  the 2.2 MB body limit still apply. A CAPTCHA was left out; add one if the global cap gets hit.
- **Schema.** Migration `024_feedback_anonymous.sql` (vendored from upstream `002`) makes
  `feedback_items.author_id` nullable and adds `author_name` and `anon_key`. A CHECK keeps both
  fields on anonymous rows only. Account deletion still cascades to the user's own items.


## Appearance setting: System / Light / Dark (2026-11-06)

Tony asked for dark mode across the whole app. The palette already had dark values that followed
the OS; this adds a user choice and cleans up the few places that bypassed the tokens.

- **Setting.** `system` (default, no class), `light` or `dark` (`<html class="light|dark">`, which
  theme.css already honours). Stored in localStorage `ujc:theme` (removed for System; every
  access wrapped in try/catch, falls back to memory for the page view). Code in
  `apps/web/src/lib/theme-core.ts` (pure, usable from the server layout) and `lib/theme.tsx`
  (hook + controls). Changes in another tab sync through the `storage` event.
- **No flash.** A tiny inline script in the root layout's `<head>` adds the saved class before
  the body paints; `<html>` has `suppressHydrationWarning` for that. The theme-color metas now
  use the real page background (`#f4f2ef` / `#0e0d0c`) and are rewritten to the forced palette
  when Light or Dark is picked.
- **Controls.** A compact icon button next to the language switch (TopNav on wide screens, the
  phone hero row) cycles System → Light → Dark; icon = current mode (monitor / sun / moon),
  accessible name "Appearance: X. Switch to Y". The account sheet has a three-way segmented
  picker. The styleguide's appearance switch now drives the same setting; its `?theme=` query
  is a preview only and the saved choice comes back when leaving `/design`.
- **Token clean-up.** `text-zinc-500` loading text, the red `require-auth` error box, the
  hard-coded brand gradient in `BrandMark` and the "love" text gradient now use tokens; the text
  gradient got a lighter dark-mode variant (`--ujc-brand-text-gradient`). The sidebar badge used
  label-secondary on fill-secondary (4.1:1 in dark) and now uses label. Left as is on purpose:
  the white tile behind tech logos (so dark logos stay visible), white glyphs on the brand
  gradient, the Toggle knob, source brand colours, the canvas screenshot fill in
  contributor-box and the OG image.

## Public roadmap (2026-11-07)

Status: accepted. Code: `apps/web/src/app/roadmap/`, `apps/api/src/ujc_api/routers/feedback.py`
(`public_board=True`), contributor-box `Roadmap` (upstream DECISIONS 14 and 15).

- **Public, indexed.** `/roadmap/` works signed out (`lib/public-routes.ts`), has its own title,
  description, canonical and Open Graph tags, and is listed in `sitemap.xml`; robots.txt already
  allows it. `/contribute/` stays signed-in and `noindex`.
- **Columns are the public statuses only**: "Under consideration" (`approved`), "Planned", "Done".
  `under_review` is the private triage step and can hold unmoderated text or personal details, so
  it is not shown; there is no "In progress" status and none was added (it would need a migration
  and an admin workflow change).
- **Signed out** sees vote counts as a "Sign in to vote" link; "Suggest an idea" opens the floating
  widget with "Feature idea" preselected (guests can send, see "Anonymous feedback").
- **Navigation.** TopNav item for everyone; on phones a tab for signed-out visitors (Jobs, Blog,
  Roadmap) and an account-sheet row for signed-in users (their five tabs are unchanged);
  `/contribute/` links to it.
- **Feedback panel** sizes to its content (no inner scrollbar at 1440x900 or 390x844, signed in or
  out); it only scrolls when the viewport is too short.

## Job description sections and seniority level (2026-11-07)

Request: show every job description with the same sections, headings and look, whatever the
board's layout; and show each job's level with a recognisable badge. Code:
`apps/crawler/src/job_crawler/sections.py`, `level.py`, `derived.parse_posting`,
`db.backfill_sections`, `db/migrations/025_job_sections.sql`, `apps/web/src/app/jobs/jd-sections.tsx`,
`packages/ui/src/components/level-badge.tsx`.

- **Regex, no LLM.** Descriptions are stored as normalised plain text (`text.html_to_text`), so a
  heading is a short line: ALL CAPS, `## …`, `**…**`, "…:" or Title Case followed by a list, or a
  known phrase. A synonym table (English first, plus common de/fr/es/pt/vi headings) maps it to one
  of 13 keys: `intro` (text before the first heading), `about_company`, `about_role`,
  `responsibilities`, `requirements`, `nice_to_have`, `tech_stack`, `compensation`, `benefits`,
  `location_remote`, `hiring_process`, `other`, `equal_opportunity`. Order matters in the table
  ("Annual base salary range (excluding bonus)" is pay, not a bonus; "You'll thrive in this role if
  you have" is requirements, not responsibilities). Unknown headings: inside a recognised section a
  Title Case / "…:" line stays as a sub-heading of that section; after the intro, or when ALL CAPS /
  markdown, it starts an `other` section with its heading kept. One-line "Salary: …" /
  "Location: …" become their own sections. No text is ever dropped (a test checks every line).
- **Stored, not computed per request:** `jobs.sections` JSONB `[{key, heading, body, summary}]`
  (body = the section's text, already sanitised by the crawler like `description`; summary = the
  first three list items or two sentences, ≤ 280 chars). Stored only when at least one non-intro
  heading was recognised; otherwise NULL and the app shows the plain description as before.
- **Level:** `jobs.level` (intern, junior, mid, senior, lead, manager, director) +
  `jobs.level_source`: the board's own field first ("source": Himalayas `seniority`, Arc
  `experienceLevel(s)`; several values → the lowest), then the title ("Senior", "Sr.", "Staff",
  "Intern", "Werkstudent", "Engineer II", "Head of"; IC "Product/Account Manager" titles are not
  managers; "Assistant to the CEO" is not a director), then the description (an explicit phrase,
  else the smallest "N+ years of experience": ≤1 junior, 2–4 mid, ≥5 senior). The source is shown
  as the badge tooltip so a guessed level reads as a guess.
- **Versioning:** `jobs.sections_version` = `sections.VERSION` (1) of the rules that wrote
  `sections` + `level`; 0 = not parsed. The upsert writes the current version. A rule change bumps
  `VERSION`; `python -m job_crawler --backfill-sections [--batch N]` re-parses rows below it in
  committed batches (`FOR UPDATE SKIP LOCKED`), so it is idempotent, resumable and never downgrades
  rows written by newer code. **Production:** `--recompute-derived` (the "Recompute derived
  columns" step of `daily-crawl.yml`, and anything else that calls it on a schedule) now runs the
  backfill after the derived columns, so the first nightly run after migration 025 is applied
  fills every existing row. One-off now: `cd apps/crawler && DATABASE_URL=… uv run python -m
  job_crawler --backfill-sections`. Migration 025 is applied by the production Vercel build; the
  crawl must not run against production before that deploy (same constraint as 018/019).
  `scripts/seo-snapshot.mjs` reads `sections`/`level` only when the columns exist, so a preview
  build against the un-migrated production database still works.
- **Coverage** on 318 jobs sampled from the public API (all sources): 79% have ≥ 2 recognised
  sections overall, **97.7% of the 256 full descriptions (≥ 800 chars)**; by source: Greenhouse
  96%, Himalayas 97%, Lever 100%, Ashby 100%, Remotive 92%, We Work Remotely 80% (its RSS gives a
  400-char summary for some jobs), SEEK 0% (teaser only), Arc / LinkedIn 0% (no description
  stored). Unmapped headings left: 2 of ~1,490. Level found for 72% (Greenhouse 94%, Himalayas
  100%, WWR 74%, Lever 58%, LinkedIn 60%, Arc 56% from titles only, Ashby 52%, Remotive 46%,
  SEEK 20%); 36% from titles, 19% from the board, 17% from descriptions. Arc rows will rise once
  the backfill reads their stored `experienceLevel`.
- **UI:** fixed order (`JD_SECTION_KEYS`), one icon and one translated title (en + vi) per key,
  the posting's own heading as a small subtitle; Requirements / Nice to have as checklists; short
  benefits (3–16 items ≤ 60 chars) as chips; sections over 900 chars fold with "Show more" (open
  when they contain a searched word); EEO always starts folded. Level badge: early career green,
  IC ladder teal with a 1–4 bar meter, management amber with its own glyph; "Level: Senior" for
  screen readers. Theme tokens only. The list API carries `level`; a level filter was left out (the
  filter bar belongs to the sort/filter work).
