# Screen specs

Applies [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) to the product. The primary path follows
[FLOW_V2.md](../product/FLOW_V2.md): **/login (email + OTP) → /cv (upload, scan, keywords) → / (feed) ↔ /search
(live search)**. Later screens from [E2E_FLOW.md](../product/E2E_FLOW.md) (job detail, tracker, connections,
search profiles) are specified at the end and use the same patterns.

Rules for every screen:
- Static export: no dynamic segments; ids go in query params (`/jobs/view?id=`), read with `useSearchParams()` inside `<Suspense>`.
- Every data view has four states: **loading** (skeleton with the same footprint, `aria-busy`), **empty** (EmptyState + next step), **error** (EmptyState `tone="error"` or inline banner + retry), **success**.
- Copy lives in one strings module per screen (see voice and tone, DESIGN_SYSTEM §2).
- Components are from `@ujc/ui`. Page background is `bg-grouped` unless noted.

## 0. App shell

```
Desktop ≥768                                         Phone <768
┌───────────┬──────────────────────────────────┐     ┌──────────────────────────┐
│ ☀ Brand   │  ‹ Back        Feed        (LN)  │ ←  │        Feed        (LN)  │ ← NavBar, inline title
│           │                                  │     │                          │   appears after scroll
│ ▣ Feed 12 │  Good morning, Linh              │ ←  │ Good morning, Linh       │ ← large title (h1)
│ ⌕ Search  │  12 new since yesterday          │     │ [⌕ Filter your feed   ]  │
│ ▤ My CV   │  [⌕ Filter your feed        ] ⓧ  │     │ ┌──────────────────────┐ │
│ ▥ Tracker │  ┌────────────────────────────┐  │     │ │ JobCard              │ │
│           │  │ JobCard                    │  │     │ └──────────────────────┘ │
│           │  └────────────────────────────┘  │     │                          │
│───────────│                                  │     ├──────────────────────────┤
│ (LN) Linh │                                  │     │ ▣Feed ⌕Search ▤CV ▥Track │ ← TabBar (material)
└───────────┴──────────────────────────────────┘     └──────────────────────────┘
```

- **Sidebar** (`Sidebar`, ≥ 768): BrandMark, nav items (Feed with a badge for new jobs, Search, My CV, Tracker when M4 lands), footer with Avatar + email; clicking it opens an account Sheet (Sign out, Delete CV, Privacy).
- **TabBar** (`TabBar`, < 768): the same items (max 5). Content gets `pb-[calc(52px+env(safe-area-inset-bottom))]`.
- **NavBar**: `largeTitle` on top-level screens (Feed, Search, My CV, Tracker); inline title with a back button on pushed screens (job detail). Trailing slot: Avatar (phone) or contextual action.
- **Toasts**: one `ToastProvider` at the root; toasts appear top-centre under the NavBar.
- **Footer** (public pages only): source attribution ("Jobs by Adzuna"), Privacy, Terms. It is `text-footnote text-label-secondary`.
- **Auth guard**: a 401 from any call → `/login?next=<path>`. Signed-in users without a CV who open `/` are sent to `/cv`.
- **Offline / API down**: inline banner under the NavBar (`Badge tone="warning"` style row): "You're offline. We'll refresh when you're back."

## 1. Sign in / sign up: `/login` (email → 6-digit code)

Sign-in and sign-up are the same step. Centred single column, max width 400, `bg-grouped`, no sidebar or tab
bar. The BrandMark sits at the top.

```
            ☀ Unified Job Crawler

        Find work you'll love            ← text-large-title, centred
  Enter your email and we'll send you a
  6-digit code. No password needed.      ← text-body label-secondary

  ┌ Card ─────────────────────────────┐
  │ Email                             │
  │ [ you@example.com              ]  │  ← TextField type=email autocomplete=email
  │ [        Continue              ]  │  ← Button lg fullWidth (filled)
  └───────────────────────────────────┘
  By continuing you agree to the Terms and Privacy notice.   ← footnote, links tint
```

Step 2 (same route, local state `step=code`; the email is kept in state):

```
  ‹ Use a different email
        Check your email                 ← title1
  We sent a code to linh@example.com.
  It works for 10 minutes.
        [4][8][2][1][ ][ ]               ← CodeField, autoFocus, auto-submits on 6th digit
  [        Sign in                ]      ← Button lg, loading while verifying
  Didn't get it?  Send a new code (45s)  ← plain Button, disabled with countdown
  ┌ review mode only ─────────────────┐
  │ ⓘ Preview mode: your code is 482193│  ← Badge tone=info row, only when devCode present
  └───────────────────────────────────┘
```

| State | Behaviour |
|---|---|
| Loading | Continue / Sign in buttons `loading` (spinner, disabled, `aria-busy`). |
| Email invalid | Inline `TextField error` "That email looks incomplete — check the part after @." |
| 429 on send | Inline footnote under the button: "Too many tries for now. You can try again in {s} seconds." with a live countdown. |
| Wrong code (400) | CodeField `error` (red ring), message "That code didn't work. Check the email and try again." The code is cleared and refocused. |
| Expired (410) | Message "This code has expired." + Button tinted "Send a new code". |
| Too many attempts (429) | "Too many tries. Ask for a new code." The CodeField is disabled. |
| Success | Navigate to `next` (same-origin only) or `/cv` if the user has no CV, else `/`. Toast: "Welcome, {name or email}". |

Accessibility: one `h1` per step; when the step changes, move focus to the step's heading (or to CodeField). The
countdown is announced only when it reaches 0 ("You can send a new code now").

## 2. Onboarding (3 steps): Sign in → Your CV → Keywords

FLOW_V2 turns the old 5-step wizard into 3 steps. `ProgressSteps` sits at the top of `/cv` while the user has no
saved keywords: `["Sign in", "Your CV", "Keywords"]` (step 1 already done). After the keywords are saved, the
steps disappear and `/cv` becomes the normal CV screen.

## 3. CV, scan and keywords: `/cv`

```
  ✓ Sign in ─── ② Your CV ─── 3 Keywords         ← ProgressSteps (first run only)

  My CV                                           ← large title
  ┌ Card (drop zone, dashed separator border) ─────────────┐
  │              [spot illustration: cv]                   │
  │              Start with your CV                        │
  │   We'll pull out your skills and find jobs that fit.   │
  │            [ ⤒ Upload CV ]   or drop a file here       │
  │        PDF, image, TXT or MD · up to 5 MB              │
  └────────────────────────────────────────────────────────┘
```

The drop zone is a `<label>` wrapping a visually hidden `<input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md">`.
Keyboard users reach it as a button. On drag-over: the border becomes `tint` and the background `tint-soft`.

**Scan status card** (after upload; polls `GET /api/cvs/{id}` every 2s with backoff):

```
  ┌ Card ───────────────────────────────────────────────┐
  │ ▤  linh-nguyen-cv.pdf                    [Remove]   │
  │    Reading your CV…                     ◌ spinner   │  ← status row
  │    ▓▓▓▓▓▓▓▓░░░░░░  (indeterminate shimmer bar)       │
  │    Usually under a minute. You can leave this page. │
  └─────────────────────────────────────────────────────┘
```

| CV `status` | UI |
|---|---|
| `queued` (< 30 s) | Badge neutral "In queue" + "Reading your CV…" |
| `queued` (≥ 30 s, scanner offline) | Badge warning "Waiting for the scanner" + "Your CV is safe in the queue and will be read as soon as it's back." No error colour. |
| `processing` | Badge tint "Scanning" + Spinner + shimmer bar |
| `done` | Badge success "Ready" with check; the card collapses to a summary row (headline, seniority); the keyword review appears below with `animate-pop-in` |
| `error` | Badge danger "Couldn't read it" + error text + Button tinted "Try again" / plain "Upload a different file" |
| Upload 413 / 415 | Inline error under the drop zone: "That file is over 5 MB." / "We can read PDF, images, TXT or MD." |

**Keyword review** (first run = step 3, later = edit preferences):

```
  Here's what we found                                   ← title2
  Remove anything that doesn't fit, or add your own.

  [React ×] [Next.js ×] [TypeScript ×] [Design systems ×] [+ Add]   ← Chip onRemove; Add → inline TextField
  ┌ GroupedList "Where you can work" ─────────────────┐
  │ Remote only                               (●──)   │  ← ListRow + Toggle
  │ I'm based in                       Vietnam   ›    │  ← opens Sheet with country list (CANDIDATE_COUNTRIES)
  └───────────────────────────────────────────────────┘
  We'll hide remote jobs that aren't open to Vietnam.     ← group footer
  [            Show my jobs             ]                ← Button lg filled → PUT preferences → /
```

Validation: at most 30 keywords of ≤ 40 characters each (inline footnote when exceeded). If the user removes every
keyword, the Save button is disabled and the hint says "Add at least one keyword". Save → Button loading → toast
"Saved. Here are your jobs" → `/`.

Account and privacy: below the keyword review, a GroupedList holds "Delete CV" (destructive row → alert Sheet
"Delete this CV?").

## 4. Home / Feed: `/` (signed in)

```
  Good morning, Linh                     (LN)    ← NavBar largeTitle (greeting by local time)
  12 new since yesterday · React, Next.js, +2 ✎  ← subheadline; ✎ = plain link "Edit" → /cv
  [⌕ Filter your feed                     ⓧ]     ← SearchField (q, debounced 300 ms)
  (All sources ▾) (Remote) (Open to Vietnam)    ← Chips: source picker Sheet + toggles

  ┌ JobCard (match ring, source, remote, summary) ┐
  │  …                         [🔖] [Apply ↗]      │  ← actions: Save (IconButton), Apply (tinted sm)
  └───────────────────────────────────────────────┘
  ┌ JobCard ┐  ┌ JobCard ┐ …                       ← 1 column (<1024), 2 columns ≥1280 optional
  ◌ Loading more…                                  ← sentinel + spinner
  You're all caught up. New jobs arrive every morning.
```

- Data: `GET /api/feed?cursor=&limit=20&q=&source=`. Infinite scroll uses an `IntersectionObserver` sentinel 600px before the end. A visible "Load more" `Button gray` is the fallback, shown when the observer is unavailable or a page fails. Results are appended, never re-sorted. A polite live region says "Loaded 20 more jobs".
- Chips for the user's keywords are shown in the subtitle; editing goes to `/cv`.
- Cards: `JobCard` with `detailsHref=/jobs/view?id=`, `linkAs={Link}`, `actions`. If no CV score exists, the card shows no ring (no "0").
- New since last visit: `Badge tone="tint"` "New" in the `status` slot.

| State | UI |
|---|---|
| Loading (first page) | 3 × `JobCardSkeleton` in an `aria-busy` container |
| Loading (next page) | Spinner row "Loading more…" under the list |
| Empty (keywords match nothing) | EmptyState search: "No matches yet — let's widen the net" · "Try fewer keywords, or turn off Remote only." · Button "Edit keywords" + plain "Search live instead" → `/search?q=<keywords>` |
| Empty (filter q) | "Nothing in your feed for "{q}"" · plain Button "Search all platforms for "{q}"" → `/search?q=` |
| Error (first page) | EmptyState error + "Try again" |
| Error (next page) | Inline row "Couldn't load more." + Button gray sm "Try again"; already-loaded cards stay |
| End | footnote "You're all caught up…" |

## 5. Live search: `/search`

```
  Search                                    ← large title
  [⌕ Job title, skill or company        ⓧ]  ← SearchField autoFocus; Enter or 500 ms idle starts search
  (Seek ✓) (Himalayas ✓) (Remotive ✓) (WWR ✓) (Arc ✓)   ← Chips selected = included sources
  Seek 20 · Himalayas 18 · Remotive 6 · WWR 4 · Arc ⚠    ← per-source result strip (SourceBadge + count)
  ┌ JobCard ┐ …  (infinite scroll, same as feed)
```

- Data: `GET /api/search/live?q=&sources=&cursor=`. A new query cancels the previous request (AbortController) and resets the list. The URL keeps `?q=` so the back button and sharing work.
- **Progress**: while the first page loads, the source strip shows each source with a Spinner. Each finishes on its own as `sources[]` returns. Skeleton cards appear below.
- **Partial failure**: a source with `error` shows `Badge tone="warning"` "{Source} didn't answer". The rest render normally, and a single non-blocking toast says "Seek didn't answer this time. Results from the other sources are below."
- Exhausted sources (`null` in the cursor) show a check in the strip. When all are exhausted, show "That's everything for "{q}"."
- Upwork never appears (terms); a footnote at the end offers "Search on Upwork ↗" as a deep link.

| State | UI |
|---|---|
| Idle (no query) | EmptyState search "Search every platform at once" · "Results come straight from Seek, Himalayas, Remotive, We Work Remotely and Arc." + recent queries as Chips |
| Loading | Source strip spinners + 3 skeleton cards |
| Empty | "Nothing on {sources} for "{q}" right now" + tip to broaden |
| Error (all sources failed / network) | EmptyState error + "Try again" |
| Success | Cards. Jobs already in the user's feed show a "In your feed" neutral Badge. |

## 6. Job detail: `/jobs/view?id=`

Pushed screen: NavBar inline title (company name), back button "‹ Feed", `bg-background`, reading width 680.

```
  ‹ Feed            Canva                [🔖]
  (C)  Senior Frontend Engineer (Next.js)        ← title1
       Canva · Sydney                            ← subheadline secondary
  [Himalayas] [Remote · APAC] [Full-time] [A$150k–180k]
  ┌ Card (tint-soft background) ─────────────────┐
  │ (91)  Great fit                              │  ← MatchBadge ring 56 + band label
  │ Your 5 years of React … line up with …       │
  │ Skills to brush up: GraphQL · Storybook      │
  └──────────────────────────────────────────────┘
  About the role                                  ← title3
  description as text (whitespace-pre-line), body, max-w-2xl
  ─────────────────────────────────────────────── sticky bottom bar (material-bar) on phone:
  [ Save ]                     [ Apply on Himalayas ↗ ]
```

States: loading = skeleton title + 6 text lines; not found = EmptyState "This job is no longer available" + "Back
to your feed"; error = EmptyState error + retry. "Apply" opens `applyUrl ?? url` in a new tab and then offers a
toast with action "Did you apply? **Mark as applied**", which leads to the celebration toast.

## 7. Search profiles + results (E2E M2-03; after FLOW_V2)

- `/profiles`: GroupedList of profiles. Each row has its name, keywords as subtitle, detail "12 new", and a chevron. An empty state ("Make your first search profile") leads to "New profile". A limit reached at 20 shows a footnote.
- `/profiles/edit?id=`: a form in GroupedLists (Name, Keywords TextField with syntax hint, Locations Chips, Remote only Toggle, I'm based in row → Sheet, Sources: GroupedList with a Toggle per source and a SourceBadge dot icon tile).
- `/profiles/view?id=`: NavBar large title = profile name; subtitle = last run per source; trailing Button sm "Run search" (`loading` while the task runs; a progress Toast "Searching 5 sources…"). Toolbar: SearchField + Chips (source, remote, min score as SegmentedControl Any / 50+ / 70+ / 85+) + Button tinted "Score with CV". The list is the same as the feed.

## 8. CV & matches (E2E F5/F6; extends `/cv`)

- Several CVs: a GroupedList with one row per CV (file icon tile, filename, "Ready · Senior · 14 skills", status Badge). Tapping a row opens a detail Sheet with headline, seniority, skill Chips and summary.
- Scoring progress on results: a Toast "Scoring 60 jobs with your CV…" with a determinate count in the message ("24 of 60"), and the score rings fill in as results arrive (700 ms ring animation; instant under reduced motion).
- Quota reached: inline warning row "You've used today's scoring. It resets at 7:00." Never a blocking modal.

## 9. Connections: `/connections` (E2E M3)

GroupedLists by kind, using ListRow + icon tiles in source colours:
- **Built-in** (always on): rows with detail "Always on" and a footnote with the last crawl time.
- **Your accounts (runner)**: LinkedIn / Seek / Glassdoor / Arc rows with status Badges (success "Logged in", warning "Needs login", neutral "Unknown"). The "Add runner" row opens a Sheet with the consent text, then the code `ABCD-EFGH` in `text-title1 font-mono`, a 10-minute countdown and three copyable command blocks (mono, `bg-fill-tertiary`, IconButton "Copy").
- **API keys**: an Adzuna row with detail "••••1a2b" or "Built-in", and a Sheet form to add a key ("We'll test it before saving").
- **Upwork**: an info Card "In-app Upwork search is coming", with a Button "Use Upwork in Claude" and a plain "Search on Upwork ↗".
- **Claude (MCP)**: a list of tokens and "Create token". It is shown once in an alert Sheet with Copy.

Empty / error states follow the same patterns. Toggle changes save immediately and confirm with a toast.

## 10. Tracker: `/tracker` (board / list)

```
  Tracker                         [Board | List]    ← SegmentedControl in NavBar children
  Saved 4        Applied 3       Interviewing 1   Offer 0      (Closed 2 ▸)
  ┌────────┐     ┌────────┐      ┌────────┐       ┌ empty ┐
  │ card   │     │ card   │      │ card   │       │ Drop  │
  └────────┘     └────────┘      └────────┘       │ here  │
                                                  └───────┘
```

- **Board** (≥ 1024; horizontally scrollable columns on smaller screens). Each column has a header (title3 + count Badge) and cards: a compact JobCard (title, company, SourceBadge, MatchBadge pill, "Next: follow up Fri", "4 days in Applied"). Drag and drop is supported, and **every card also has a "Move to…" IconButton (More)** that opens a Sheet listing the statuses. That Sheet is the keyboard and screen-reader path (PRD: keyboard drag alternative).
- **List**: one GroupedList per status with ListRow (title, company · days in status, MatchBadge pill accessory).
- Card tap opens a detail Sheet: notes (textarea), next action date, history timeline, links.
- Moving a card to Applied for the first time triggers the celebration toast "Marked as applied — good luck!" and, on the first application ever, the `celebrate` empty-state illustration in the Applied column header for that session.
- Empty: EmptyState tracker "Nothing tracked yet" · "Save a job from your feed and it'll show up here." · Button tinted "Browse your feed".
- Error on move: the card snaps back with `ease-spring`, and a toast (error) "Couldn't move that card" with a Retry action.

## 11. Settings (later)

iOS Settings layout: GroupedLists Account (email, based in, timezone, language), Notifications (Daily digest
Toggle + time row), Privacy (Download my data, Withdraw AI consent, Delete account: destructive row → alert
Sheet that requires typing DELETE).
