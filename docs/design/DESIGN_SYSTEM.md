# Sunrise: the job-seeking design system

Owner: product-designer agent (`.claude/agents/product-designer.md`). Status: v1 (D-01, issue #37).
Source of truth for values: `packages/ui/src/theme.css`. Components: `packages/ui/src/`. Living styleguide:
`/design` (`apps/web/src/app/design/`). Screen specs: [SCREENS.md](./SCREENS.md).

Sunrise is a Cupertino-style system (iOS/macOS conventions, system font, grouped lists, translucent bars), warmed
up for people who are job hunting. Job hunting is stressful and often lonely. The product should feel like a
friend who is good at this and is on your side.

## 1. Principles

| # | Principle | What it means in practice |
|---|---|---|
| 1 | **Friendly coach, not a corporate ATS** | Speak to the user ("you"), never about them. No dense data tables on the main path. One clear next step per screen. |
| 2 | **Warm** | Warm neutrals (greys shifted toward the tint), a sunrise-orange accent, soft shadows, rounded 14px cards. Friendly illustrations in empty states. |
| 3 | **Encouraging** | Scores are framed as fit, not judgement: "Great fit / Good fit / Worth a look / Long shot". Missing skills are "Skills to brush up". Celebrate applying. |
| 4 | **Calm** | One accent colour. Semantic colours only for meaning. Motion is short and springy, never bouncy loops. No red unless something actually failed. |
| 5 | **Progress-oriented** | Always show where the user is (scan status, steps, "12 new since yesterday", tracker columns) and what happens next. |
| 6 | **Honest about sources** | Every job shows a source badge and links to the original posting. We never hide where data came from. |
| 7 | **Platform-native** | Use the conventions people already know from their phone: large titles, tab bar, sheets, switches, segmented controls. |

## 2. Voice and tone

- **Plain English at B1 level.** Many users read English as a second language (Vietnamese developers). Short sentences, common words, no idioms that do not translate ("ballpark", "circle back").
- **Sentence case** everywhere (buttons, titles, menus). No ALL CAPS except the footnote-sized group headers in grouped lists.
- **Verbs on buttons**: "Upload CV", "Find jobs", "Save", not "OK" / "Submit".
- **Errors**: say what happened, whose side it is, and what to do. Never blame. Never show raw codes as the main message.
- **Localisation-ready**: every string is a whole sentence with placeholders (`"{count} new since yesterday"`), never concatenated fragments. Keep strings in one module per screen (PRD §6). Leave ~35% extra width for Vietnamese (it runs longer and needs room for diacritics: line-height ≥ 1.3 on all text tokens). Components take their default English strings as props (`clearLabel`, `closeLabel`, `label`, `removeLabel`), so pages can pass translations.

### Example microcopy

| Moment | Copy |
|---|---|
| Greeting (feed, morning) | "Good morning, Linh" · subtitle "12 new matches since yesterday" |
| Greeting (no new jobs) | "Welcome back, Linh" · "Nothing new since this morning. We'll keep looking." |
| Sign-in | Title "Find work you'll love" · "Enter your email and we'll send you a 6-digit code. No password needed." |
| Code sent | "We sent a code to **linh@example.com**. It works for 10 minutes." · link "Use a different email" |
| Wrong code | "That code didn't work. Check the email and try again — you have 3 tries left." |
| Code expired | "This code has expired. We can send you a new one." · button "Send a new code" |
| Rate limited | "Too many tries for now. You can try again in 45 seconds." |
| CV upload | "Start with your CV" · "We'll pull out your skills and find jobs that fit." · "PDF, image, TXT or MD, up to 5 MB." |
| CV scanning | "Reading your CV…" · "Usually under a minute. You can leave this page." |
| Scanner offline | "Waiting for the scanner. Your CV is safe in the queue and will be read as soon as it's back." |
| CV failed | "We couldn't read this file. If it's a photo or scan, try a clearer PDF." · "Try again" |
| Keywords review | "Here's what we found" · "Remove anything that doesn't fit, or add your own." |
| Empty feed | "No matches yet — let's widen the net" · "Try fewer keywords, or turn off Remote only." · "Edit keywords" |
| Empty live search | "Nothing on {sources} for "{query}" right now" · "Try a broader title, like "frontend" instead of "senior React engineer"." |
| End of feed | "You're all caught up. New jobs arrive every morning." |
| Partial source failure | "Seek didn't answer this time. Results from the other sources are below." |
| Network error | "We couldn't load jobs. It's on our side, not yours. Check your connection and try again." |
| Save | Toast "Saved to your tracker" |
| Applied (celebration) | Toast "Marked as applied — good luck!" · "We'll remind you to follow up in 7 days." Empty-state illustration `celebrate` on the tracker after the first application: "You applied — nice work!" |
| Offer | Badge "Offer!" (solid tint) · "Congratulations, Linh. Take your time to decide." |
| Destructive confirm | Title "Delete this CV?" · "Its text, keywords and scores are removed right away. Your saved jobs stay." · buttons "Keep it" / "Delete" |
| Score bands | 85+ "Great fit" · 70–84 "Good fit" · 50–69 "Worth a look" · < 50 "Long shot" |

## 3. Colour

All colours are semantic tokens. Components never use raw hex values. In CSS they are Tailwind utilities
(`bg-grouped`, `text-label-secondary`, `bg-tint`, `border-separator`); in inline styles or SVG attributes they
are the runtime variables `var(--ujc-<name>)`.

Light/dark: tokens follow `prefers-color-scheme`. `<html class="dark">` forces dark and `<html class="light">`
forces light. The Tailwind `dark:` variant is redefined to match both, so legacy `dark:` classes keep working.

### 3.1 Tint: Sunrise orange

| | Light | Dark |
|---|---|---|
| `tint` (links, filled buttons, focus ring, selected) | `#C2410C` | `#FF8A50` |
| `tint-pressed` / hover | `#A8380A` | `#FF9E6E` |
| `tint-ink` (text on `tint-soft`) | `#9A3412` | `#FF8A50` |
| `on-tint` (text on `tint`) | `#FFFFFF` | `#1F0D02` |
| `tint-vivid` (illustrations only, never text) | `#F76B1C` | `#FF8A50` |
| `tint-soft` | tint at 12% | tint at 18% |

**Why orange.** Orange is the colour of a sunrise: a new start every morning, which is what a job search needs
to feel like. It reads as energetic and optimistic without the "error" meaning of red, and it is warm and
approachable (in Vietnam, orange and gold are festive, lucky colours). It also differs on purpose from the blue
of LinkedIn, Seek's pink and the greens of the ATS sources, so our UI chrome never competes with the source
badges. Apple's own `systemOrange` (#FF9500) is only 2.2:1 on white, so we use a deeper burnt orange in light
mode. That gives 5.2:1 for white text on a filled button and 4.6:1 for orange link text on the grouped background
(AA for body text). Dark mode uses a lighter, peachy orange with **dark** text on filled buttons (8.1:1), because
white on it would be only 2.3:1.

### 3.2 Neutrals (warm system colours)

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FFFFFF` | `#0E0D0C` | Plain pages, inputs |
| `background-secondary` | `#F4F2EF` | `#1C1B1A` | Wells, secondary areas |
| `background-tertiary` | `#FFFFFF` | `#2C2A28` | Elevated content in secondary areas |
| `grouped` | `#F4F2EF` | `#0E0D0C` | Page behind cards and grouped lists (default app background) |
| `grouped-secondary` | `#FFFFFF` | `#1C1B1A` | Cards, list cells |
| `grouped-tertiary` | `#F4F2EF` | `#2C2A28` | Cells inside cells |
| `label` | `#1C1B1A` | `#F5F4F2` | Primary text |
| `label-secondary` | `#5E5B57` | `#ADA9A3` | Secondary text, metadata |
| `label-tertiary` | `#6E6A65` | `#8A867F` | Placeholders, hints, inactive tab |
| `label-quaternary` | `#A9A5A0` | `#5A5752` | Disabled text, chevrons (decorative only) |
| `separator` | `rgb(60 52 44 / .20)` | `rgb(255 248 240 / .14)` | Hairlines |
| `separator-opaque` | `#DEDAD5` | `#3A3835` | Lines over images / materials |
| `control-border` | `#8F8A84` | `#75716B` | Text field edges (≥ 3:1, WCAG 1.4.11) |
| `fill` / `-secondary` / `-tertiary` | `rgb(120 114 106 / .20 / .16 / .10)` | `rgb(130 124 116 / .36 / .30 / .22)` | Control tracks, chips, search field, skeletons |

Unlike Apple's `secondaryLabel` (60% alpha, about 3.4:1 on white, which fails AA), our secondary and tertiary
labels are opaque and pass AA for body text.

### 3.3 Semantic

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `success` / `success-ink` | `#1A7F37` / `#146C2E` | `#30D158` | Applied, connected, great fit, switch on |
| `info` / `info-ink` | `#0E7A86` / `#0B656F` | `#40C8E0` | Remote / eligibility, good fit, neutral info |
| `warning` / `warning-ink` | `#A35C00` / `#8A4D00` | `#FFD60A` | Needs attention, worth a look, interviewing |
| `danger` / `danger-ink` | `#D70015` / `#B00012` | `#FF6961` | Errors, destructive actions |

Each also has a `-soft` background (12% light / 18% dark). Text on a soft background always uses the `-ink`
colour.

### 3.4 Source colours (harmonised)

Brand colours come from `packages/core` `SOURCES[id].color` and are **not** changed there. `SourceBadge`
harmonises them so every source passes AA in both modes:
- The brand colour is used only for an 8px **dot** (identity), and in dark mode it is mixed 30% toward white so dark brands (Arc indigo, LinkedIn blue) stay visible.
- The pill background is the brand colour at **12%** (light) or **24%** (dark) over the surface.
- The label text is always `label`: worst case 12.6:1 (light) and 11.0:1 (dark) across all 11 sources.

White-on-brand fills (the old badge) failed AA for Greenhouse (3.2:1), Ashby (3.2:1) and Glassdoor (3.0:1);
the new treatment removes the problem for any future source. Brand colours may also fill `ListRow` icon tiles
(white glyph, non-text 3:1).

### 3.5 Contrast table (WCAG 2.2, computed)

| Pair | Light | Dark |
|---|---|---|
| label on background | 17.2 | 17.7 |
| label on grouped-secondary (card) | 17.2 | 15.7 |
| label-secondary on background / grouped | 6.8 / 6.0 | 8.3 / 7.4 (on card) |
| label-tertiary on background / grouped | 5.4 / 4.8 | 5.4 / 4.8 (on card) |
| tint text on background / grouped | 5.2 / 4.6 | 8.3 / 7.4 (on card) |
| on-tint on tint (filled button) | 5.2 | 8.1 |
| tint-ink on tint-soft | 6.1 | 5.3 |
| success-ink / info-ink / warning-ink / danger-ink on own soft | 5.6 / 5.7 / 5.7 / 5.9 | 6.0 / 6.1 / 7.7 / 4.7 |
| danger text on grouped | 4.8 | 5.1 (on elevated) |
| control-border vs background / grouped (non-text, ≥ 3) | 3.4 / 3.1 | 4.0 / 3.6 |
| focus ring (tint) vs background (non-text, ≥ 3) | 5.2 | 8.3 |

## 4. Typography

Font stack (no web font download; SF on Apple devices, full Vietnamese coverage everywhere):
`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
(`font-display` uses "SF Pro Display" first). Monospace: `ui-monospace, "SF Mono", Menlo, Consolas`.

Dynamic-Type-like scale. Utilities are `text-<token>` and carry size, line-height, tracking and (for titles)
weight. At ≥ 1024px the scale steps down one notch, as macOS is denser than iOS. Large titles stay big, and
nothing goes below 12px.

| Token | Mobile (px) | Desktop ≥1024 (px) | Line-height | Tracking | Weight | Use |
|---|---|---|---|---|---|---|
| `large-title` | 34 | 32 | 1.20 | −0.022em | 700 | Page title (NavBar large title), greeting |
| `title1` | 28 | 26 | 1.22 | −0.020em | 700 | Hero numbers, onboarding titles |
| `title2` | 22 | 21 | 1.27 | −0.016em | 700 | Section titles |
| `title3` | 20 | 19 | 1.25 | −0.012em | 600 | Empty-state titles, card group titles |
| `headline` | 17 | 15 | 1.30 | −0.010em | 600 | Job title, list emphasis, inline nav title |
| `body` | 17 | 15 | 1.42 | −0.010em | 400 | Default text, buttons (semibold) |
| `callout` | 16 | 14 | 1.38 | −0.008em | 400 | Match summary, descriptions |
| `subheadline` | 15 | 13 | 1.34 | −0.006em | 400 | Company/location, field labels, chips |
| `footnote` | 13 | 12 | 1.38 | −0.002em | 400 | Metadata, helper and error text, group headers |
| `caption` | 12 | 12 | 1.34 | 0 | 400 | Badges, tags, tab labels |
| `micro` | 11 | 11 | 16px | 0 | 600 | Numeric count badges only |

Rules: at most 3 sizes per card. Use weight and colour (label → secondary → tertiary) for hierarchy before
using size. Numbers that update (scores, counts) use `tabular-nums`.

## 5. Spacing and layout

- **4-pt grid**: Tailwind's spacing unit is 4px (`p-1` = 4, `p-4` = 16). Use 4, 8, 12, 16, 20, 24, 32, 48. Never use odd values.
- Page gutters: 16 (mobile), 24 (≥ 640), content max width 1024 (`max-w-5xl`). Reading width for descriptions: 680 (`max-w-2xl`).
- Card padding 16. Card gap in lists 12. Section gap 48.
- Grouped list rows: min height 44, text inset 16, separator inset to the text (57 when the row has an icon tile).
- Breakpoints: `< 768` phone layout with tab bar · `≥ 768` sidebar (256px) + content · `≥ 1024` desktop density type.

## 6. Radii (continuous-corner feel)

| Token | Value | Use |
|---|---|---|
| `rounded-icon` | 7 | 29px icon tiles in list rows |
| `rounded-control-sm` | 8 | Small buttons, segment thumb, tags |
| `rounded-control` | 10 | Buttons, fields, segmented track, company logos |
| `rounded-card` | 14 | Cards, grouped lists, toasts, large buttons |
| `rounded-sheet` | 20 | Sheets, dialogs, device-like frames |
| `rounded-full` | pill | Badges, chips, switches, avatars, icon buttons |

Nested radii: inner = outer − padding (e.g. a 10px button in a card with 4px padding is 14 − 4 = 10). CSS
`corner-shape: squircle` may be added as progressive enhancement once it is in Safari. Until then, we get the
continuous feel by keeping radii generous relative to element size.

## 7. Materials

| Utility | Recipe | Use |
|---|---|---|
| `material-bar` | `var(--ujc-material)` (white 72% / #1C1B1A 72%) + `backdrop-filter: saturate(180%) blur(20px)` | NavBar (when scrolled), TabBar |
| `material-thick` | white-ish 86% + `saturate(180%) blur(30px)` | Sidebar, toasts |
| `hairline`, `hairline-t/-b/-r` | `var(--ujc-hairline)` solid `separator`; 0.5px on 2x screens, 1px otherwise | Bar edges, list separators |
| `bg-scrim` | label 32% (light) / black 50% (dark) | Behind sheets |

A NavBar with a large title is transparent at rest. Its material and bottom hairline appear only once content
scrolls under it, as in UINavigationBar.

## 8. Elevation

| Token | Light | Dark |
|---|---|---|
| `shadow-card` | `0 1px 2px rgb(60 40 20/.06), 0 1px 1px rgb(60 40 20/.04)` | hairline ring `rgb(255 248 240/.08)` (shadows are invisible on black) |
| `shadow-raised` | `0 4px 12px …/.08, 0 1px 3px …/.06` (hover cards, segment thumb, toggle knob) | ring .10 + `0 8px 24px black/.4` |
| `shadow-overlay` | `0 24px 48px …/.18, 0 8px 16px …/.08` (sheets, toasts) | ring .12 + `0 24px 64px black/.6` |

Shadows are warm-tinted (brown, not grey). In dark mode, separate surfaces by lightness steps
(`#0E0D0C → #1C1B1A → #2C2A28`) rather than shadows.

## 9. Motion

| Token | Value | Use |
|---|---|---|
| `ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` (iOS sheet curve) | Default for movement |
| `ease-standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Fades |
| `ease-snappy` | `cubic-bezier(0.2, 0.9, 0.3, 1.2)` (slight overshoot) | Celebrations only |
| Durations | 150 (hover/colour), 200 (fades, press), 250–300 (toggles, segment thumb, pop-in), 350 (sheet), 700 (score ring fill) | |
| Animations | `animate-fade-in`, `animate-sheet-up`, `animate-pop-in`, `animate-toast-in`, `animate-shimmer`, `animate-spin` | |

- Press feedback: `active:scale-[0.97]` on buttons, `0.99` on cards.
- `prefers-reduced-motion: reduce` is handled globally in `theme.css`: animations and transitions drop to 0.01ms and loops run once. Content still appears, so nothing depends on animation finishing.
- No auto-playing or looping decoration. The skeleton shimmer is the only loop, and it stops when reduced motion is on.

## 10. Iconography

- Inline SVG set in `packages/ui/src/icons.tsx`: 24px grid, 1.75 stroke, round caps and joins, `currentColor`. It is drawn to sit next to SF Pro and the SF Symbols look.
- **No icon dependency.** We need about 30 glyphs. lucide-react would add a package and version churn for no visual gain, and our own set keeps the stroke weight consistent. Add new glyphs to `icons.tsx` in the same style.
- Sizes: 15–17 inline with text, 20 default, 22 in sidebar/tab bar. Icons are `aria-hidden` unless given a `title`. Icon-only buttons must have a `label`.

## 11. Accessibility

- **Contrast**: AA for all text (see §3.5), ≥ 3:1 for field edges, focus rings and state indicators.
- **Targets**: 44 × 44px minimum. `Button size="sm"` (32px) and `IconButton size="sm"` add an invisible `::before` hit area to reach 44px. Rows are ≥ 44px tall.
- **Focus**: every interactive element shows a 2px `tint` outline with 2px offset on `:focus-visible` (`focus-ring` utility, plus a global `:focus-visible` default). Text fields use a tint border plus a 4px tint/20 halo instead. Never remove focus without a replacement.
- **Labels**: fields always have a visible `<label>`; placeholders are examples, not labels. Errors are linked with `aria-describedby` and set `aria-invalid`.
- **Roles**: `SegmentedControl` = radiogroup with roving tabindex (arrows, Home/End). `Toggle` = `role="switch"` + `aria-checked`. `Sheet` = `dialog`/`alertdialog`, `aria-modal`, labelled by its title, focus trapped, Esc closes, focus returns to the opener. `Toast`: success and info use `role="status"`; errors use `role="alert"`. Navigation marks the current page with `aria-current="page"`, and steps with `aria-current="step"`.
- **Colour is never the only signal**: scores show the number and band label (screen readers hear "CV fit 88 out of 100, great fit"); the switch also moves its knob; source badges carry the source name.
- Lists that load show skeletons inside a container with `aria-busy="true"` and an accessible label.
- Infinite scroll always has a real "Load more" button as a fallback, and it announces "Loaded 20 more jobs" via a polite live region.
- Text resizes: all sizes are in `rem`, so browser zoom and user font size work.

## 12. Components (packages/ui)

| Component | File | Notes |
|---|---|---|
| `NavBar` | `components/navigation.tsx` | Sticky; large title collapses into the inline title; `leading`/`trailing`/children slots |
| `Sidebar`, `TabBar`, `BrandMark`, `NavItem` | `components/navigation.tsx` | Sidebar ≥ 768, tab bar < 768 (max 5 items), `linkAs` for Next `Link` |
| `Button`, `IconButton`, `Spinner`, `buttonClasses()` | `components/button.tsx` | filled / tinted / gray / plain / destructive; sm / md / lg; `loading` |
| `TextField`, `SearchField`, `CodeField` | `components/fields.tsx` | SearchField clear (x) + Esc; CodeField = OTP (one input, `one-time-code`) |
| `SegmentedControl` | `components/segmented-control.tsx` | Sliding thumb, keyboard arrows |
| `Toggle` | `components/toggle.tsx` | iOS switch 51 × 31, green when on |
| `Card`, `GroupedList`, `ListRow` | `components/surfaces.tsx` | Settings-style rows with icon tile, detail, accessory |
| `Badge`, `Chip`, `SourceBadge`, `MatchBadge`, `matchBand()` | `components/badges.tsx` | MatchBadge `variant="ring"` (Activity ring) or `"pill"` |
| `Skeleton`, `JobCardSkeleton`, `EmptyState`, `SpotIllustration`, `Avatar`, `ProgressSteps` | `components/feedback.tsx` | Illustrations: search, cv, tracker, error, celebrate, connect |
| `Sheet` | `components/sheet.tsx` | Bottom sheet on phones, centred card ≥ 640; `variant="alert"` |
| `ToastProvider`, `useToast`, `Toast` | `components/toast.tsx` | Top-centre stack, max 3, auto-dismiss 4s (errors 7s) |
| `JobCard`, `timeAgo()`, `employmentLabel()` | `components/job-card.tsx` | `{ job }` API unchanged; optional `detailsHref`, `actions`, `status`, `linkAs` |

Backward compatibility: `JobCard({ job })`, `SourceBadge({ source })` and `MatchBadge({ score })` keep their
original props. Every new prop is optional.

## 13. Using the system in apps/web

```css
/* apps/web/src/app/globals.css */
@import "tailwindcss";
@import "../../../../packages/ui/src/theme.css";
@source "../../../../packages/ui/src";
```

- Page background: `bg-grouped` for list/settings screens, `bg-background` for reading screens (job detail).
- Use components first. If you need a raw element, use only token utilities (`text-label-secondary`, `bg-fill-tertiary`, `rounded-card`, `shadow-card`), never `zinc-*`, hex or arbitrary values.
- Wrap the app in `<ToastProvider>` once (in a client layout component).
- Theme override: set `light`/`dark` on `<html>` (persist the choice in `localStorage` and apply it with an inline script before paint; see `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`).
