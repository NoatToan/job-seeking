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

## Job list sort options (2026-11-07)

Tony asked for sort options ("it sorts by created_at by default, right? sort by time zone, etc. —
add the ones that are actually useful"). Code: `apps/api/src/ujc_api/job_sort.py`,
`db/migrations/025_job_sort.sql`, `apps/web/src/app/job-filters.tsx` (`useSortOptions`).

**Default stays "Newest first", and it was already right.** It never used a `created_at` (jobs has
none): it orders by `coalesce(posted_at, first_seen_at)` — the board's own date, else when our
crawler first saw the job — then `id`. That is the date a candidate cares about (a job crawled today
but posted a month ago should not look new), so nothing changed there.

Added (`sort=` on `GET /api/jobs` and `GET /api/feed`; the web keeps it in the URL as `?sort=`, the
default is never written):

| `sort` | Order | Why it earns a place |
|---|---|---|
| `newest` (default) | posted date, else first seen | unchanged |
| `timezone` (+ `tz`) | fewest whole hours between the job's 9–5 and the viewer's 9–5, on a 24h circle; best of the job's zones; ties newest first; jobs with no known zone last | Most users are in Vietnam / Asia applying to remote jobs; hours overlap decides whether a job is livable. Same measure as the badge on each row (`workHoursFit` in `lib/work-hours.ts`), so a "Same time zone" job never sorts below a "Night shift" one. |
| `salary` | `salary_usd_year` high to low; jobs without a comparable salary last | The one number candidates compare first. |
| `match` (feed only) | CV match score, unscored jobs last | Replaces the old "Best matches" toggle (`sort=score`, still accepted). It is now paginated instead of a fixed top 50, and keeps unscored jobs after the scored ones instead of hiding them. |

How it works:

- **Pagination stays a keyset for every sort.** Keyed sorts order by `(key DESC, posted-or-seen
  DESC, id DESC)` with `key` an integer that is never NULL (a sentinel puts "unknown" last), so one
  row comparison pages it with no duplicates or gaps, even when many jobs share a key. Their cursor
  is `{s, k, t, i}` and is refused (400 `invalid_cursor`) by any other sort; the newest cursor is
  unchanged (`{t, i}`), so lists already open keep working.
- **Time zone is computed per request, not stored.** It depends on the viewer's zone and on DST at
  that moment, so a stored column would be wrong for everyone but one zone. The API builds a
  `{zone: gap hours}` table for every IANA zone plus every `UTC±hh:mm` the crawler writes (~700
  entries, cached per hour since DST changes on the hour) and passes it as one jsonb parameter; per
  row SQL only looks up the job's zones. The web sends `tz` = the same zone it shows hours in (saved
  preference, else the browser's). Cost: a scan of the filtered jobs, ~80–110 ms at 50k jobs on a
  laptop (no index can serve a per-viewer key). Whole hours, not minutes, so a +8 job and a +7 job
  count as equally good and newer jobs win inside each hour.
- **Salary is normalised, roughly, in a generated column.** Top of the range (`salary_max`, else
  `salary_min`), annualised like `Salary.yearly` (hour x 2080, day x 260, week x 52, month x 12)
  and divided by fixed approximate rates (units per USD, late 2026) for the 29 currencies the
  parser emits. Without conversion, a VND or INR monthly wage would top the list; with rough rates
  the order is right to within the rate error, which is fine for ranking and is never shown as a
  converted amount. Unknown currency or period = not comparable = last. It is a `STORED` generated
  column with an index matching the keyset, so the sort is an index scan. Changing a rate means a
  new migration that drops and re-adds the column.
- "Best match" is not offered on the public catalogue (no CV score there; the API answers 400). A
  shared `?sort=match` link opened in "All jobs" falls back to newest.
- The sort is not a filter: "Clear all" and the "N filters" count ignore it, except the folded hero
  summary and the phone "Filters" badge, which count a non-default order so a reordered list never
  looks untouched.

Rejected:

- **"Open to me first"**: the "Open to me" toggle and the Remote region select already filter by
  it; a sort would only move the excluded jobs to the bottom of an infinite list.
- **Company, title, source A–Z**: nobody browses jobs alphabetically.
- **Most relevant (full-text rank)** for a search: possible later, but `q` today is a filter and
  `ts_rank` across short postings ranks poorly without tuning; out of scope.
- **Lowest salary / oldest first**: no use case.

Known data issue surfaced by the salary sort: a few salaries parsed from descriptions have the
wrong period (e.g. an intern's "R$ 1.350" monthly stipend stored as hourly, a "$200 meal voucher"
read as $200/hour), which puts them at the top. That is a `job_crawler.salary` parsing bug to fix
there, not in the sort.

## Release notes (2026-11-07)

Status: accepted. Code: `apps/web/src/app/release-notes/`, `apps/web/src/lib/release-notes.ts`,
`apps/web/src/content/release-notes.json`, `scripts/release-notes/`, `.github/workflows/release-notes.yml`.
Setup: [`DEVELOPMENT.md`](DEVELOPMENT.md) "Release notes".

- **A committed JSON file, not a database or an API.** The page is part of the static export and
  needs no backend; the history is reviewable in git and can be edited by hand. Each push to
  `main` rebuilds the site anyway (Vercel is Git-connected), so the page is never staler than the
  latest deploy.
- **One entry per day, rewritten as the day goes on.** Commits are grouped by the local day
  (`Asia/Ho_Chi_Minh`, where the team works) of the newest commit; a later push on the same day
  sends Claude the earlier entry and gets back the full updated one. Per-push entries would turn a
  busy day (55 commits on 2026-11-06) into dozens of tiny notes. A day can still be split by hand
  (`2026-11-06` and `2026-11-06-2` in the backfill); the generator then keeps updating the newest.
- **Only user-visible changes.** A cheap filter drops merges, `chore/docs/test/ci/style/build`
  commits and commits that only touch docs, tests, CI or tooling, so most chore pushes never call
  the API; the prompt tells Claude to skip internal names, guesses and invisible work, and it can
  answer `skip: true`. At most 8 one-line highlights per entry, each in `en` and `vi`.
- **Claude with structured output, validated twice.** `claude-sonnet-5` (named in the request; a
  writing task, not a reasoning one) with `output_config.format` = a JSON Schema, then
  `schema.mjs` checks lengths, single lines and categories (which JSON Schema in structured outputs
  can't express), then the whole file is re-validated before it is written. Plain `fetch`, no SDK:
  one request from a Node script in CI, no `node_modules` needed in the job.
- **No loops.** The bot pushes with `GITHUB_TOKEN`, and GitHub never starts workflows from such
  pushes; on top of that the job skips notes-only pushes (`paths-ignore`) and the bot actor, and
  the script drops commits whose subject carries `[skip release-notes]` (the bot's subject does).
  Only the subject counts, so docs that merely mention the marker don't hide a commit. The same
  marker lets a human keep a commit out. Not `[skip ci]`: that would also skip the CI run.
- **Fail soft, retry for free.** No key, an API error, a refusal or invalid output ends the run
  with a notice or warning and exit 0. Nothing is lost: the anchor (`commits.to` of the newest
  entry) only moves when an entry is written, so the next push covers the same commits.
  `concurrency: release-notes` (no cancel) keeps two runs from writing at once, and the job checks
  out the tip of `main` so a queued run covers the pushes it waited for; the push step rebases and
  retries if `main` moved meanwhile.
- **Backfill written by hand** (by Claude in the session that built this) from `git log`: 8 entries
  from 2026-10-26 to 2026-11-07; the 2026-10-18 scratch commit is left out.
- **Page.** Activity summary ("N updates in the last 30 days", counted from the visitor's own
  date after hydration, from the build date before it), a 12-week commit-day strip, category
  filter chips, a timeline with the latest entry highlighted, optional screenshot, a link to the
  commits on GitHub, and an Atom feed (`feed.xml`, built at export time). Linked from a "What's new
  · <date>" chip in the public home hero and from the account sheet; the TopNav was left alone
  (other work touches it, and the chip already reaches signed-out visitors on every screen size).

## Navigation: public tabs + profile menu; editable profile (2026-11-07)

Status: accepted. Code: `apps/web/src/app/nav.tsx`, `apps/web/src/app/profile-menu.tsx`,
`apps/web/src/app/profile/`, `apps/api/src/ujc_api/routers/profile.py`,
`db/migrations/026_user_profile.sql`.

- **Why.** Signed in, the desktop top bar had seven text tabs (Jobs, Live search, Tracker, My CV,
  Connections, Blog, Roadmap) and read as cluttered. Public places and personal tools were mixed.
- **Desktop top bar = public places only**: Jobs, Roadmap (`usePublicNavItems`; Release notes is
  appended there when it lands; the blog stays hidden). Right side: GitHub, theme, language, then
  "Sign in" (signed out) or the avatar (signed in).
- **Profile menu (avatar)**: header with display name, headline and email; then "Your job search"
  (For you, Live search, Tracker, My CV, Connections), "Community" (Contribute, Review feedback
  for admins), "Account" (Edit profile, Account & privacy), Sign out. Live search counts as
  personal: it needs a session and uses the user's own rate limit. ARIA menu-button pattern
  (Enter/Space/ArrowDown open on the first item, ArrowUp on the last, arrows wrap, Home/End, Esc
  and Tab close and return focus to the avatar, outside click closes). When the page on screen is
  in the menu the avatar shows a tint ring and the item is `aria-current="page"`.
- **Phones (< md)**: the tab bar keeps the most used places — Jobs, Tracker, CV — plus a Profile tab
  that opens the same menu as a sheet (For you, Live search, Connections, Contribute, Roadmap, Edit
  profile, Account & privacy, theme, Sign out). The Profile tab is tinted while one of those pages
  is open. Live search and Connections lost their tabs: they are used far less than the
  tracker and the CV, and four tabs leave each one a wider target. Signed out: Jobs, Roadmap,
  Sign in. The per-page phone header avatar (`AccountMenu`) now renders only "Sign in" for
  visitors and nothing once signed in, so there is one way into the account, not two.
- **Edit profile (`/profile/`, `GET/PATCH /api/me/profile`)**: display name (1-60, single line, no
  control/bidi characters), headline (1-120), LinkedIn / GitHub / website (https only, no
  credentials, LinkedIn and GitHub must be on their own domains, max 300), plus the existing
  based-in country, time zone and keywords / remote only. Country and time zone are *not*
  duplicated: they stay `user_preferences.candidate_country` / `digest_tz`, which the feed and the
  digest already read. `PATCH` is partial (only keys sent change, `null` clears), CSRF-protected,
  and rejects unknown keys. The form saves optimistically (menu name and greeting update at once)
  and rolls back with an error toast if the API refuses.
- **Avatar: generated, no upload.** Initials + a colour derived from the name (`Avatar`). Upload is
  skipped: it needs object storage, image re-encoding to strip metadata/polyglots, size limits and
  moderation — not "simple and safe" for this release.
- **Display name** replaces the email in the menu and the home greeting ("Good morning, Linh
  Nguyen"); it is used as written, because Vietnamese names put the given name last.

## Job description sections and seniority level (2026-11-07)

Request: show every job description with the same sections, headings and look, whatever the
board's layout; and show each job's level with a recognisable badge. Code:
`apps/crawler/src/job_crawler/sections.py`, `level.py`, `derived.parse_posting`,
`db.backfill_sections`, `db/migrations/027_job_sections.sql`, `apps/web/src/app/jobs/jd-sections.tsx`,
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

## Database audit: indexes and query counts (2026-11-07)

Status: accepted. Code: `db/migrations/028_query_indexes.sql`, `apps/api/src/ujc_api/{worker,digest}.py`,
`apps/api/src/ujc_api/auth/session.py`, `apps/api/src/ujc_api/routers/me.py`,
`apps/api/tests/test_query_counts_db.py`. Details and EXPLAIN numbers: [`product/PERFORMANCE.md`](product/PERFORMANCE.md).

- **An index is added only when EXPLAIN shows a gain** on a seeded 80k-job database.
  Migration 027 adds three:
  - `jobs (first_seen_at)` for the digest: 51 ms → 6 ms per user.
  - `jobs (source, first_seen_at)` for the sources summary: 40 ms → 6 ms, index-only. It
    replaces the redundant `jobs (source)`.
  - A partial `tasks (locked_at) WHERE status = 'running'`, so the worker's requeue before every
    poll no longer scans every done task.

  Everything else already had a matching index, so there are no trigram or extra GIN indexes.
- **Plain `CREATE INDEX`, not `CONCURRENTLY`**: both migrators run each file in a transaction,
  where `CONCURRENTLY` can't run. At 5–10k jobs the lock lasts under a second during the Vercel
  build. If `jobs` grows past a few hundred thousand rows, move index builds to a separate step
  that runs outside a transaction.
- **Unused indexes stay until production data says otherwise.** `jobs_posted_at_idx` and
  `jobs_last_seen_at_idx` had no scans in the benchmark. Dropping them would not make crawler
  updates HOT, so they stay until `pg_stat_user_indexes` in production shows whether they are
  used.
- **The number of queries per endpoint is part of the contract.** `test_query_counts_db.py`
  pins the count for each list endpoint and fails if it grows with the data (N+1). Fixes made
  during the audit:
  - The `match_score` task writes all its matches in one statement.
  - The digest no longer re-reads preferences for each user.
  - `GET /api/me` is one statement (it was six).
  - The session check on every signed-in request is one `UPDATE … RETURNING` (it was a
    `SELECT` followed by an `UPDATE`).
- **contributor-box issues go upstream**, not into the vendored copy: vote counts computed as
  per-row subqueries, `OFFSET` paging with a separate `count(*)`, and `ILIKE` search. See
  PERFORMANCE.md "Upstream".

## Selects: our own fuzzy select everywhere, full backend lists (2026-11-07)

Status: accepted. Code: `packages/ui/src/fuzzy.ts`, `packages/ui/src/components/fuzzy-select.tsx`,
`packages/ui/src/search-keywords.ts`, `apps/web/src/app/{pill-controls,tech-filter,country-filter,work-hours,mobile-filters}.tsx`.

- **Why ("lists show very few items").** The backend already sends everything
  (`GET /api/jobs/facets`: 224 countries, 45 techs; `/api/sources`: 11). The client cut it:
  `FuzzySelect` rendered at most 200 rows (`maxResults`) and the phone filter view sliced time zones
  to 200, so with ~420 alphabetical zones nothing after early "Asia/…" (Ho Chi Minh, every
  Australia/Europe/Pacific zone) and the last 24 countries could be scrolled to; the tech filter
  showed only the frontend and backend groups, 10 chips each, so 25 of 45 techs (AWS, Kubernetes,
  Docker, PostgreSQL, React Native…) were never offered. The rest of the pickers were native
  `<select>`s, whose only search is the browser's first-letter type-ahead.
- **No native `<select>` in the app.** Filter bar (Source, Posted, Remote region, Sort), tracker
  status, profile country + time zone, CV country + digest hour and onboarding country all use
  `FuzzySelect`. The filter bar keeps its pill look through `variant="pill"` (`PillSelect`); forms
  use `variant="form"` (with `<label htmlFor>` → trigger `id`) or `variant="row"` (grouped settings
  rows). `name` adds a hidden input so the value posts with a `<form>`; `required` / `invalid` /
  `describedBy` map to ARIA. Not converted: `packages/contributor-box` (self-contained admin widget
  without a `@ujc/ui` dependency).
- **Search box only from 7 options** (`SEARCH_THRESHOLD`). Posted, Sort, Remote region and the
  tracker status open as a plain list (letters still jump to a row, like a native select). Lists
  that are long in production (countries) pass `searchable` so they always have it.
- **Matching** (`fuzzy.ts`): lower case, accents folded (Vietnamese "việt" = "viet", "đ" = "d"),
  separators `_ / - . ,` read as spaces. Tiers: exact > prefix > word start > acronym ("ny" → New
  York, "hcm" → Ho Chi Minh) > substring > all words in any order > subsequence; inside a tier
  earlier and shorter wins. Options carry `keywords` searched but not shown: countries get ISO code,
  English and Vietnamese names and aliases (USA, UK, Holland…); zones get abbreviation, UTC/GMT
  offset and aliases (Saigon, Hà Nội, NYC…). Matched letters of the label are highlighted.
- **Behaviour**: ARIA select-only combobox trigger + listbox with `aria-activedescendant`; ↑ ↓
  PageUp PageDown Home End, Enter picks, Esc closes and refocuses the trigger, typing on the closed
  trigger opens it with that letter searched. Home/End move in the list even from the search box
  (the box is short; caret moves are rarely needed there). Lists from 60 rows are virtualised
  (fixed row height, only rows in view + 6 rendered, `aria-setsize`/`aria-posinset` kept), so every
  zone and country is reachable without a cap. Phones (< 768px) open a bottom sheet with the search
  on top (17px text so iOS doesn't zoom); no native picker.
- **Tech filter**: every tech from the facets, grouped Frontend / Backend / Mobile / Data / Cloud &
  DevOps, most common first, with a fuzzy search box over the chips (desktop panel and phone step).
