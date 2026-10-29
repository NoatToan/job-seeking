"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { Job } from "@ujc/core";
import { SOURCES } from "@ujc/core";
import {
  Avatar,
  Badge,
  BookmarkIcon,
  BrandMark,
  BriefcaseIcon,
  Button,
  Card,
  CheckIcon,
  Chip,
  CodeField,
  DocumentIcon,
  EmptyState,
  ExternalLinkIcon,
  GlobeIcon,
  GroupedList,
  IconButton,
  JobCard,
  JobCardSkeleton,
  KanbanIcon,
  LinkIcon,
  ListRow,
  MatchBadge,
  MoonIcon,
  MoreIcon,
  NavBar,
  PlusIcon,
  ProgressSteps,
  RefreshIcon,
  SearchField,
  SearchIcon,
  SegmentedControl,
  Sheet,
  Sidebar,
  Skeleton,
  SourceBadge,
  SparklesIcon,
  SunIcon,
  TabBar,
  TextField,
  Toast,
  ToastProvider,
  Toggle,
  TrashIcon,
  UploadIcon,
  UserIcon,
  useToast,
} from "@ujc/ui";
import type { NavItem } from "@ujc/ui";

type ThemeMode = "system" | "light" | "dark";

/** Sets `.light` / `.dark` on <html> (system = neither). Cleans up when leaving the page. */
function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  // `?theme=dark` / `?theme=light` preselects an appearance (handy for screenshots).
  const fromUrl = useSearchParams().get("theme");
  const [mode, setMode] = useState<ThemeMode>(fromUrl === "light" || fromUrl === "dark" ? fromUrl : "system");
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (mode !== "system") root.classList.add(mode);
    return () => root.classList.remove("light", "dark");
  }, [mode]);
  return [mode, setMode];
}

const colorGroups: Array<{ title: string; tokens: Array<{ name: string; light: string; dark: string; note: string }> }> = [
  {
    title: "Backgrounds",
    tokens: [
      { name: "background", light: "#FFFFFF", dark: "#0E0D0C", note: "Page" },
      { name: "background-secondary", light: "#F4F2EF", dark: "#1C1B1A", note: "Wells, inputs" },
      { name: "grouped", light: "#F4F2EF", dark: "#0E0D0C", note: "Grouped page" },
      { name: "grouped-secondary", light: "#FFFFFF", dark: "#1C1B1A", note: "Cards, cells" },
      { name: "grouped-tertiary", light: "#F4F2EF", dark: "#2C2A28", note: "Nested cells" },
    ],
  },
  {
    title: "Labels & lines",
    tokens: [
      { name: "label", light: "#1C1B1A", dark: "#F5F4F2", note: "17.2:1 / 15.7:1" },
      { name: "label-secondary", light: "#5E5B57", dark: "#ADA9A3", note: "6.8:1 / 7.4:1" },
      { name: "label-tertiary", light: "#6E6A65", dark: "#8A867F", note: "5.4:1 / 4.8:1" },
      { name: "label-quaternary", light: "#A9A5A0", dark: "#5A5752", note: "Disabled only" },
      { name: "separator", light: "rgb(60 52 44/.2)", dark: "rgb(255 248 240/.14)", note: "Hairlines" },
      { name: "control-border", light: "#8F8A84", dark: "#75716B", note: "≥3:1 field edge" },
    ],
  },
  {
    title: "Tint & semantic",
    tokens: [
      { name: "tint", light: "#C2410C", dark: "#FF8A50", note: "Sunrise · 5.2:1 / 7.4:1" },
      { name: "tint-vivid", light: "#F76B1C", dark: "#FF8A50", note: "Illustration only" },
      { name: "success", light: "#1A7F37", dark: "#30D158", note: "Applied, great fit" },
      { name: "info", light: "#0E7A86", dark: "#40C8E0", note: "Remote, good fit" },
      { name: "warning", light: "#A35C00", dark: "#FFD60A", note: "Worth a look" },
      { name: "danger", light: "#D70015", dark: "#FF6961", note: "Errors, delete" },
    ],
  },
];

const typeScale: Array<{ cls: string; name: string; spec: string; sample: string }> = [
  { cls: "text-large-title", name: "largeTitle", spec: "34 / 32 desktop · bold", sample: "Good morning, Linh" },
  { cls: "text-title1", name: "title1", spec: "28 / 26 · bold", sample: "12 new matches today" },
  { cls: "text-title2", name: "title2", spec: "22 / 21 · bold", sample: "Your keywords" },
  { cls: "text-title3", name: "title3", spec: "20 / 19 · semibold", sample: "No matches yet — let's widen the net" },
  { cls: "text-headline", name: "headline", spec: "17 / 15 · semibold", sample: "Senior Frontend Engineer" },
  { cls: "text-body", name: "body", spec: "17 / 15 · regular", sample: "We'll look for jobs that fit your CV and are open to Vietnam." },
  { cls: "text-callout", name: "callout", spec: "16 / 14", sample: "Strong React and Next.js match for a remote APAC team." },
  { cls: "text-subheadline", name: "subheadline", spec: "15 / 13", sample: "Canva · Sydney · Remote (APAC)" },
  { cls: "text-footnote", name: "footnote", spec: "13 / 12", sample: "Crawled 2 hours ago from Himalayas" },
  { cls: "text-caption", name: "caption", spec: "12 / 12", sample: "Full-time · 3 days ago" },
];

const navItems: NavItem[] = [
  { key: "feed", label: "Feed", href: "#shell", icon: <BriefcaseIcon size={22} />, badge: 12 },
  { key: "search", label: "Search", href: "#shell", icon: <SearchIcon size={22} /> },
  { key: "cv", label: "My CV", href: "#shell", icon: <DocumentIcon size={22} /> },
  { key: "tracker", label: "Tracker", href: "#shell", icon: <KanbanIcon size={22} /> },
  { key: "account", label: "Account", href: "#shell", icon: <UserIcon size={22} /> },
];

const now = Date.now();
const sampleJobs: Job[] = [
  {
    id: "1",
    source: "himalayas",
    url: "https://example.com/jobs/1",
    applyUrl: null,
    title: "Senior Frontend Engineer (Next.js)",
    company: "Canva",
    location: "Sydney",
    remote: true,
    employmentType: "full_time",
    salaryText: "A$150k – 180k",
    tags: ["react", "next.js", "typescript"],
    openTo: ["APAC"],
    postedAt: new Date(now - 2 * 86_400_000).toISOString(),
    firstSeenAt: new Date(now - 2 * 86_400_000).toISOString(),
    match: {
      score: 91,
      summary: "Your 5 years of React and design-system work line up with what they need.",
      missingSkills: ["GraphQL", "Storybook"],
    },
  },
  {
    id: "2",
    source: "seek",
    url: "https://example.com/jobs/2",
    applyUrl: null,
    title: "Full-stack Developer",
    company: "Employment Hero",
    location: "Ho Chi Minh City",
    remote: false,
    employmentType: "contract",
    salaryText: null,
    tags: ["node", "postgres"],
    openTo: null,
    postedAt: null,
    firstSeenAt: new Date(now).toISOString(),
    match: { score: 63, summary: "Good backend overlap; the role leans on Ruby you haven't listed.", missingSkills: ["Ruby on Rails"] },
  },
  {
    id: "3",
    source: "weworkremotely",
    url: "https://example.com/jobs/3",
    applyUrl: null,
    title: "React Native Engineer",
    company: "Doist",
    location: null,
    remote: true,
    employmentType: "full_time",
    salaryText: null,
    tags: ["react-native"],
    openTo: ["WORLDWIDE"],
    postedAt: new Date(now - 5 * 86_400_000).toISOString(),
    firstSeenAt: new Date(now - 5 * 86_400_000).toISOString(),
  },
];

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} id={id} className="flex scroll-mt-16 flex-col gap-4">
      <div>
        <h2 id={`${id}-h`} className="text-title2 text-label">
          {title}
        </h2>
        {intro ? <p className="mt-1 max-w-2xl text-subheadline text-label-secondary">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Specimen({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-semibold uppercase tracking-wide text-label-tertiary">{label}</p>
      <div className={className ?? "flex flex-wrap items-center gap-3"}>{children}</div>
    </div>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="tinted"
        onClick={() =>
          toast.show({ tone: "success", title: "Marked as applied — good luck!", message: "We'll remind you to follow up in 7 days." })
        }
      >
        Success toast
      </Button>
      <Button
        variant="gray"
        onClick={() =>
          toast.show({ tone: "error", title: "Couldn't reach Seek", message: "Other sources still worked. Try again in a minute.", action: { label: "Retry", onClick: () => undefined } })
        }
      >
        Error toast
      </Button>
      <Button variant="plain" onClick={() => toast.show({ tone: "info", title: "Scanning your CV…", message: "Usually under a minute." })}>
        Info toast
      </Button>
    </div>
  );
}

function StyleguideBody() {
  const [mode, setMode] = useThemeMode();
  const [view, setView] = useState<"board" | "list">("board");
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [digest, setDigest] = useState(false);
  const [query, setQuery] = useState("next.js remote");
  const [code, setCode] = useState("4821");
  const [keywords, setKeywords] = useState(["React", "Next.js", "TypeScript", "Design systems"]);
  const [filters, setFilters] = useState({ remote: true, worldwide: false, contract: false });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  return (
    <div className="min-h-full bg-grouped pb-24">
      <NavBar
        title="Design system"
        trailing={
          <IconButton
            label={mode === "dark" ? "Use light appearance" : "Use dark appearance"}
            icon={mode === "dark" ? <SunIcon /> : <MoonIcon />}
            onClick={() => setMode(mode === "dark" ? "light" : "dark")}
          />
        }
      >
        <p className="max-w-2xl text-body text-label-secondary">
          Sunrise — a warm, Cupertino-style system for job seekers. A friendly coach, not a corporate ATS. Tokens live in{" "}
          <code className="font-mono text-callout">packages/ui/src/theme.css</code>; rules in{" "}
          <code className="font-mono text-callout">docs/design/DESIGN_SYSTEM.md</code>.
        </p>
        <SegmentedControl
          label="Appearance"
          className="w-full max-w-xs"
          value={mode}
          onChange={setMode}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: <><SunIcon size={15} /> Light</>, ariaLabel: "Light" },
            { value: "dark", label: <><MoonIcon size={15} /> Dark</>, ariaLabel: "Dark" },
          ]}
        />
      </NavBar>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 pt-4">
        <Section id="colour" title="Colour" intro="Semantic tokens only. Each swatch follows the current appearance; values are light / dark.">
          {colorGroups.map((g) => (
            <Specimen key={g.title} label={g.title} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {g.tokens.map((t) => (
                <div key={t.name} className="flex flex-col gap-1.5">
                  <div
                    className="h-14 rounded-control shadow-card"
                    style={{ background: `var(--ujc-${t.name})` }}
                    aria-hidden
                  />
                  <p className="text-footnote font-semibold text-label">{t.name}</p>
                  <p className="text-caption text-label-secondary">
                    {t.light} / {t.dark}
                  </p>
                  <p className="text-caption text-label-tertiary">{t.note}</p>
                </div>
              ))}
            </Specimen>
          ))}
          <Specimen label="Sources (brand dot on a 12% wash, label colour text)">
            {["weworkremotely", "greenhouse", "lever", "ashby", "himalayas", "remotive", "adzuna", "linkedin", "seek", "arc", "glassdoor"].map((s) => (
              <SourceBadge key={s} source={s} />
            ))}
          </Specimen>
        </Section>

        <Section id="type" title="Typography" intro="System font stack (SF Pro on Apple devices). Dynamic-Type-like scale; one step denser at ≥1024px.">
          <Card padding="none" className="divide-y divide-separator">
            {typeScale.map((t) => (
              <div key={t.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                <div className="w-44 shrink-0">
                  <p className="text-footnote font-semibold text-label">{t.name}</p>
                  <p className="text-caption text-label-tertiary">{t.spec}</p>
                </div>
                <p className={`${t.cls} min-w-0 text-label`}>{t.sample}</p>
              </div>
            ))}
          </Card>
        </Section>

        <Section id="shape" title="Spacing, radii, elevation & materials" intro="4-pt grid. Radii 7 / 8 / 10 / 14 / 20 / pill. Bars are translucent with a saturated blur and a hairline.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Specimen label="Radii" className="flex flex-wrap items-end gap-3">
              {[
                ["icon 7", "rounded-icon"],
                ["control-sm 8", "rounded-control-sm"],
                ["control 10", "rounded-control"],
                ["card 14", "rounded-card"],
                ["sheet 20", "rounded-sheet"],
                ["pill", "rounded-full"],
              ].map(([label, cls]) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div className={`size-14 bg-tint-soft ring-1 ring-tint/40 ${cls}`} />
                  <span className="text-caption text-label-secondary">{label}</span>
                </div>
              ))}
            </Specimen>
            <Specimen label="Elevation" className="flex flex-wrap gap-4">
              {[
                ["card", "shadow-card"],
                ["raised", "shadow-raised"],
                ["overlay", "shadow-overlay"],
              ].map(([label, cls]) => (
                <div key={label} className={`flex size-20 items-center justify-center rounded-card bg-grouped-secondary text-caption text-label-secondary ${cls}`}>
                  {label}
                </div>
              ))}
            </Specimen>
            <Specimen label="Spacing (4-pt grid)" className="flex items-end gap-2">
              {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <div className="w-4 rounded-sm bg-tint" style={{ height: n * 4 }} />
                  <span className="text-caption text-label-tertiary">{n * 4}</span>
                </div>
              ))}
            </Specimen>
            <Specimen label="Material over content" className="block">
              <div className="relative h-28 overflow-hidden rounded-card">
                <div className="absolute inset-0 flex flex-wrap gap-2 p-3">
                  {["weworkremotely", "seek", "himalayas", "lever", "ashby", "linkedin", "remotive", "greenhouse"].map((s) => (
                    <SourceBadge key={s} source={s} />
                  ))}
                  <MatchBadge score={91} variant="ring" />
                  <MatchBadge score={63} variant="ring" />
                </div>
                <div className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center material-bar hairline-t text-headline text-label">
                  material-bar
                </div>
              </div>
            </Specimen>
          </div>
        </Section>

        <Section id="buttons" title="Buttons">
          <Specimen label="Variants">
            <Button icon={<SparklesIcon size={18} />}>Find my matches</Button>
            <Button variant="tinted" icon={<BookmarkIcon size={18} />}>
              Save
            </Button>
            <Button variant="gray">Not now</Button>
            <Button variant="plain">Edit keywords</Button>
            <Button variant="destructive" icon={<TrashIcon size={18} />}>
              Delete CV
            </Button>
          </Specimen>
          <Specimen label="Sizes & states">
            <Button size="lg">Continue</Button>
            <Button size="md">Continue</Button>
            <Button size="sm">Continue</Button>
            <Button loading>Scanning…</Button>
            <Button disabled>Disabled</Button>
          </Specimen>
          <Specimen label="Icon buttons (44px; sm keeps a 44px hit area)">
            <IconButton label="Refresh" icon={<RefreshIcon />} />
            <IconButton label="Add" icon={<PlusIcon />} variant="gray" />
            <IconButton label="Save job" icon={<BookmarkIcon />} variant="tinted" />
            <IconButton label="Open original" icon={<ExternalLinkIcon />} variant="filled" />
            <IconButton label="More" icon={<MoreIcon />} variant="gray" size="sm" />
          </Specimen>
        </Section>

        <Section id="inputs" title="Inputs & controls">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-5">
              <SearchField value={query} onChange={setQuery} placeholder="Job title, skill or company" label="Search jobs" />
              <TextField label="Email" type="email" placeholder="you@example.com" hint="We'll send you a 6-digit code. No password needed." />
              <TextField label="Email" type="email" defaultValue="linh@" error="That email looks incomplete — check the part after @." />
            </div>
            <div className="flex flex-col gap-5">
              <Specimen label="One-time code">
                <CodeField value={code} onChange={setCode} />
              </Specimen>
              <Specimen label="Segmented control (←/→, Home/End)">
                <SegmentedControl
                  label="Tracker view"
                  value={view}
                  onChange={setView}
                  className="w-56"
                  options={[
                    { value: "board", label: "Board" },
                    { value: "list", label: "List" },
                  ]}
                />
              </Specimen>
              <Specimen label="Toggle">
                <Toggle label="Remote only" checked={remoteOnly} onChange={setRemoteOnly} />
                <Toggle label="Daily digest" checked={digest} onChange={setDigest} />
                <Toggle label="Disabled" checked={false} onChange={() => undefined} disabled />
              </Specimen>
            </div>
          </div>
        </Section>

        <Section id="badges" title="Badges, chips & scores">
          <Specimen label="Badges">
            <Badge>Saved</Badge>
            <Badge tone="tint">New</Badge>
            <Badge tone="info" icon={<GlobeIcon size={12} strokeWidth={2.25} />}>
              Remote · APAC
            </Badge>
            <Badge tone="success" icon={<CheckIcon size={12} strokeWidth={3} />}>
              Applied
            </Badge>
            <Badge tone="warning">Interviewing</Badge>
            <Badge tone="danger">Scan failed</Badge>
            <Badge tone="tint" variant="solid">
              Offer!
            </Badge>
          </Specimen>
          <Specimen label="Keyword chips (removable) and filter chips (toggle)">
            {keywords.map((k) => (
              <Chip key={k} onRemove={() => setKeywords((ks) => ks.filter((x) => x !== k))}>
                {k}
              </Chip>
            ))}
            <Chip onClick={() => setKeywords((ks) => [...ks, `Skill ${ks.length + 1}`])} icon={<PlusIcon size={15} />}>
              Add
            </Chip>
            <span className="mx-1 h-6 w-px bg-separator" aria-hidden />
            <Chip selected={filters.remote} onClick={() => setFilters((f) => ({ ...f, remote: !f.remote }))}>
              Remote
            </Chip>
            <Chip selected={filters.worldwide} onClick={() => setFilters((f) => ({ ...f, worldwide: !f.worldwide }))}>
              Open to Vietnam
            </Chip>
            <Chip selected={filters.contract} onClick={() => setFilters((f) => ({ ...f, contract: !f.contract }))}>
              Contract
            </Chip>
          </Specimen>
          <Specimen label="CV fit (ring + pill)">
            {[94, 78, 58, 31].map((s) => (
              <MatchBadge key={s} score={s} variant="ring" />
            ))}
            {[94, 78, 58, 31].map((s) => (
              <MatchBadge key={`p${s}`} score={s} showLabel />
            ))}
          </Specimen>
          <Specimen label="Avatars">
            <Avatar name="Linh Nguyen" />
            <Avatar name="Minh Tran" size={44} />
            <Avatar name="Sarah Lee" size={28} />
            <Avatar name="Canva" shape="rounded" size={40} />
            <Avatar name="Employment Hero" shape="rounded" size={40} />
          </Specimen>
        </Section>

        <Section id="jobs" title="Job cards" intro="JobCard keeps its { job } API. Optional detailsHref / actions / status slots for the feed.">
          <div className="grid gap-3 lg:grid-cols-2">
            <JobCard
              job={sampleJobs[0]}
              detailsHref="#jobs"
              status={<Badge tone="success" icon={<CheckIcon size={12} strokeWidth={3} />}>Applied</Badge>}
              actions={
                <>
                  <IconButton label="Save job" icon={<BookmarkIcon size={18} />} variant="gray" size="sm" />
                  <Button size="sm" variant="tinted" icon={<ExternalLinkIcon size={15} />}>
                    Apply
                  </Button>
                </>
              }
            />
            <JobCard job={sampleJobs[1]} detailsHref="#jobs" />
            <JobCard job={sampleJobs[2]} />
            <div aria-busy="true" aria-label="Loading jobs" className="flex flex-col gap-3">
              <JobCardSkeleton />
            </div>
          </div>
        </Section>

        <Section id="lists" title="Cards & grouped lists">
          <div className="grid gap-6 sm:grid-cols-2">
            <GroupedList header="Sources" footer="LinkedIn and Seek run in your own browser, slowly, so your account stays safe.">
              <ListRow icon={<GlobeIcon size={17} />} iconColor={SOURCES.himalayas.color} title="Public job boards" subtitle="We Work Remotely, Himalayas, Remotive" detail="Always on" />
              <ListRow icon={<LinkIcon size={17} />} iconColor={SOURCES.linkedin.color} title="LinkedIn" subtitle="Via the companion runner" href="#lists" detail="Connected" />
              <ListRow icon={<LinkIcon size={17} />} iconColor={SOURCES.seek.color} title="Seek" href="#lists" accessory={<Badge tone="warning">Needs login</Badge>} />
            </GroupedList>
            <div className="flex flex-col gap-6">
              <GroupedList header="Preferences">
                <ListRow title="Remote only" accessory={<Toggle label="Remote only" checked={remoteOnly} onChange={setRemoteOnly} />} />
                <ListRow title="I'm based in" detail="Vietnam" href="#lists" />
                <ListRow title="Sign out" onClick={() => undefined} destructive />
              </GroupedList>
              <Card>
                <p className="text-headline text-label">This week</p>
                <p className="mt-1 text-subheadline text-label-secondary">3 applications sent · 1 interview. You&apos;re on a roll.</p>
                <ProgressSteps className="mt-4" label="Weekly goal" steps={["Saved", "Applied", "Interview"]} current={2} />
              </Card>
            </div>
          </div>
        </Section>

        <Section id="states" title="Empty, loading & error states" intro="Every list has all four states. Empty states always offer a next step.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card padding="none">
              <EmptyState
                illustration="search"
                title="No matches yet — let's widen the net"
                message="Try fewer keywords, or turn off Remote only."
                action={<Button size="sm">Edit keywords</Button>}
              />
            </Card>
            <Card padding="none">
              <EmptyState illustration="cv" title="Start with your CV" message="We'll pull out your skills and find jobs that fit." action={<Button size="sm" icon={<UploadIcon size={16} />}>Upload CV</Button>} />
            </Card>
            <Card padding="none">
              <EmptyState illustration="tracker" title="Nothing tracked yet" message="Save a job from your feed and it'll show up here." action={<Button size="sm" variant="tinted">Browse your feed</Button>} />
            </Card>
            <Card padding="none">
              <EmptyState tone="error" illustration="error" title="We couldn't load jobs" message="It's on our side, not yours. Check your connection and try again." action={<Button size="sm" variant="gray" icon={<RefreshIcon size={16} />}>Try again</Button>} />
            </Card>
            <Card padding="none">
              <EmptyState illustration="celebrate" title="You applied — nice work!" message="We'll nudge you to follow up in a week." />
            </Card>
            <Card padding="none">
              <EmptyState illustration="connect" title="Connect more sources" message="More sources, more chances." action={<Button size="sm" variant="plain">See connections</Button>} />
            </Card>
          </div>
          <Specimen label="Skeleton" className="flex max-w-md flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </Specimen>
          <Specimen label="Onboarding progress" className="max-w-md">
            <ProgressSteps label="Setup progress" steps={["Sign in", "Your CV", "Keywords"]} current={1} />
          </Specimen>
        </Section>

        <Section id="overlays" title="Sheets & toasts">
          <div className="flex flex-wrap gap-2">
            <Button variant="gray" onClick={() => setSheetOpen(true)}>
              Open sheet
            </Button>
            <Button variant="destructive" onClick={() => setAlertOpen(true)}>
              Open alert
            </Button>
          </div>
          <ToastDemo />
          <Specimen label="Toast (static preview)" className="flex flex-col gap-2">
            <Toast tone="success" title="Marked as applied — good luck!" message="We'll remind you to follow up in 7 days." onDismiss={() => undefined} className="animate-none" />
            <Toast tone="error" title="Couldn't reach Seek" message="Other sources still worked." action={{ label: "Retry", onClick: () => undefined }} className="animate-none" />
          </Specimen>
          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Move to…"
            description="Senior Frontend Engineer · Canva"
            footer={
              <>
                <Button variant="gray" onClick={() => setSheetOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setSheetOpen(false)}>Move</Button>
              </>
            }
          >
            <GroupedList label="Status">
              <ListRow title="Saved" onClick={() => undefined} />
              <ListRow title="Applied" onClick={() => undefined} accessory={<CheckIcon size={18} className="text-tint" />} />
              <ListRow title="Interviewing" onClick={() => undefined} />
              <ListRow title="Offer" onClick={() => undefined} />
            </GroupedList>
          </Sheet>
          <Sheet
            variant="alert"
            open={alertOpen}
            onClose={() => setAlertOpen(false)}
            title="Delete this CV?"
            description="Its text, keywords and scores are removed right away. Your saved jobs stay."
            footer={
              <>
                <Button variant="gray" onClick={() => setAlertOpen(false)} fullWidth>
                  Keep it
                </Button>
                <Button variant="destructive" onClick={() => setAlertOpen(false)} fullWidth>
                  Delete
                </Button>
              </>
            }
          />
        </Section>

        <Section id="shell" title="App shell" intro="Sidebar on ≥768px, tab bar below. Large title collapses into the bar on scroll (see the top of this page).">
          <div className="grid gap-6 lg:grid-cols-[1fr_390px]">
            <div className="flex h-[440px] overflow-hidden rounded-sheet bg-grouped shadow-raised">
              <Sidebar
                fixed={false}
                items={navItems}
                activeKey="feed"
                label="Preview navigation"
                header={<BrandMark name="Unified Job Crawler" />}
                footer={
                  <div className="flex items-center gap-2.5 px-2">
                    <Avatar name="Linh Nguyen" size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-subheadline font-semibold text-label">Linh Nguyen</p>
                      <p className="truncate text-caption text-label-secondary">linh@example.com</p>
                    </div>
                  </div>
                }
              />
              <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-5">
                <p className="text-large-title text-label">Feed</p>
                <p className="text-subheadline text-label-secondary">12 new since yesterday · React, Next.js, TypeScript</p>
                <JobCard job={sampleJobs[0]} />
              </div>
            </div>
            <div className="relative mx-auto flex h-[600px] w-full max-w-[390px] flex-col overflow-hidden rounded-[44px] bg-grouped shadow-overlay ring-8 ring-label/90">
              <div className="flex-1 overflow-hidden">
                <div className="flex h-11 items-center justify-end px-4">
                  <Avatar name="Linh Nguyen" size={30} />
                </div>
                <div className="flex flex-col gap-3 px-4">
                  <p className="text-large-title text-label">Feed</p>
                  <SearchField placeholder="Filter your feed" label="Filter feed" />
                  <JobCard job={sampleJobs[0]} />
                </div>
              </div>
              <TabBar fixed={false} items={navItems.slice(0, 4)} activeKey="feed" label="Preview tabs" />
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}

export function Styleguide() {
  return (
    <ToastProvider>
      <Suspense fallback={<p className="p-8 text-body text-label-secondary">Loading styleguide…</p>}>
        <StyleguideBody />
      </Suspense>
    </ToastProvider>
  );
}
