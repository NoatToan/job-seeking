"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrandMark,
  BriefcaseIcon,
  buttonClasses,
  cx,
  DocumentIcon,
  KanbanIcon,
  Skeleton,
  TabBar,
  TopNav,
  UserIcon,
} from "@ujc/ui";
import type { NavItem } from "@ujc/ui";
import { FeedbackWidget } from "@contributor-box/react";
import { ContributorRoot } from "@/lib/contributor";
import { LanguageSwitch } from "@/lib/i18n/provider";
import { ThemeToggle } from "@/lib/theme";
import { GitHubLink } from "@/app/github-link";
import { ProfileMenuButton, ProfileSheet, profileMenuKeyFor } from "@/app/profile-menu";
import { isPublicRoute } from "@/lib/public-routes";
import { jobIdFromPath } from "@/lib/job-url";
import { useSession } from "@/lib/session";

/** Roadmap tab icon (a folded map; same stroke style). */
function RoadmapIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14" />
    </svg>
  );
}

/** Product name shown in the chrome (the repo is "job-seeking"; "crawler" read like an internal tool). */
export const BRAND_NAME = "JobSeeking";

/**
 * The public places: the desktop top bar's only tabs, for everyone (signed in or not). Personal
 * places live in the profile menu (`profile-menu.tsx`). To add a public page (e.g. Release notes),
 * append it here and to `PUBLIC_ACTIVE_PREFIXES`; on phones it then shows in the signed-out tab bar
 * and, signed in, in the profile sheet.
 */
export function usePublicNavItems(): NavItem[] {
  const { t, i18n } = useTranslation("common");
  return useMemo(
    () => [
      { key: "feed", label: t("nav.jobs"), href: "/", icon: <BriefcaseIcon size={22} /> },
      // Blog hidden from navigation for now (Tony, 2026-11-07): the daily blog crawl and the
      // /blog/ pages keep running and stay in the sitemap; only the links are gone. To bring it
      // back: { key: "blog", label: t("nav.blog"), href: "/blog/", icon: <NewspaperIcon /> },
      { key: "roadmap", label: t("nav.roadmap"), href: "/roadmap/", icon: <RoadmapIcon /> },
    ],
    // `t` keeps its identity across language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.resolvedLanguage],
  );
}

/** Path prefix -> public nav key (exact "/" is "feed"). */
const PUBLIC_ACTIVE_PREFIXES: ReadonlyArray<[string, string]> = [
  ["/blog", "blog"],
  ["/roadmap", "roadmap"],
];

/** The tab/top-bar key for the page on screen: a public place, else a profile-menu place. */
export function activeKeyFor(pathname: string): string {
  if (pathname === "/") return "feed";
  const hit = PUBLIC_ACTIVE_PREFIXES.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : profileMenuKeyFor(pathname);
}

/** Phone tab bar, signed in: the most used places get a tab, everything else is in the sheet. */
const PHONE_TAB_KEYS = ["tracker", "cv"] as const;

/**
 * The phone NavBar slot many pages render (`<div className="md:hidden"><AccountMenu /></div>`).
 * Signed out it is a "Sign in" button. Signed in it renders nothing: the tab bar's "Profile" tab
 * opens the profile sheet, and a second avatar in every header would just repeat it.
 * `variant="pill"` is the desktop "Sign in" pill.
 */
export function AccountMenu({ variant = "icon" }: { variant?: "icon" | "pill" }) {
  const { me } = useSession();
  const { t } = useTranslation("common");
  if (me) return null;
  return (
    <Link
      href="/login/"
      className={buttonClasses({
        variant: "tinted",
        size: "sm",
        className: variant === "pill" ? "rounded-full px-4" : undefined,
      })}
    >
      {t("nav.signIn")}
    </Link>
  );
}

/**
 * App shell: TopNav (>= md) or TabBar (< md), hidden on `/login` and `/design` (both are their
 * own self-contained layouts). Each page renders its own `NavBar`.
 *
 * Information architecture (docs/DECISIONS.md, "Navigation: public tabs + profile menu"):
 *  - Desktop top bar: the public places only (Jobs, Roadmap; `usePublicNavItems`), then GitHub,
 *    theme, language and either "Sign in" or the avatar that opens the profile menu with every
 *    personal place. The avatar gets an active ring while one of those places is on screen.
 *  - Phone tab bar, signed in: Jobs, Tracker, CV, Profile (opens the profile sheet: For you, Live
 *    search, Connections, Contribute, Roadmap, Edit profile, Account, theme, Sign out). Signed
 *    out: Jobs, Roadmap, Sign in.
 *
 * Signed out, the chrome shows only on a public route (home, job detail): everywhere else the
 * page's own content (e.g. `RequireAuth`) redirects to `/login`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const { t } = useTranslation("common");
  const publicItems = usePublicNavItems();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pathname = usePathname() ?? "/";
  const bareRoute =
    pathname.startsWith("/login") || pathname.startsWith("/design") || pathname.startsWith("/onboarding");
  const showChrome = !loading && !bareRoute && (Boolean(me) || isPublicRoute(pathname));
  // While the session check runs (and in the prerendered HTML) show the TopNav's frame — brand +
  // a placeholder account pill — so the page under it doesn't drop 56px when the check finishes.
  // Public routes always end up with the TopNav; private ones do for the signed-in visitor who
  // stays (a signed-out one is redirected to the bare /login anyway).
  const chromePending = loading && !bareRoute;
  const activeKey = activeKeyFor(pathname);
  // Phones: the tabs with their own slot; any other active place lights up the Profile tab.
  const phoneTabKeys = new Set<string>(["feed", ...PHONE_TAB_KEYS]);
  const sheetExtras = publicItems.filter((item) => !phoneTabKeys.has(item.key));
  const tabItems: NavItem[] = me
    ? [
        publicItems[0],
        { key: "tracker", label: t("nav.tracker"), href: "/tracker/", icon: <KanbanIcon size={22} /> },
        { key: "cv", label: t("nav.myCv"), href: "/cv/", icon: <DocumentIcon size={22} /> },
        {
          key: "profile",
          label: t("nav.profile"),
          href: "/profile/",
          icon: <UserIcon size={22} />,
          onSelect: () => setSheetOpen(true),
        },
      ]
    : [...publicItems, { key: "signIn", label: t("nav.signIn"), href: "/login/", icon: <UserIcon size={22} /> }];
  const tabActiveKey = !me || phoneTabKeys.has(activeKey) || activeKey === "" ? activeKey : "profile";
  // Pushed detail screens (job detail) own the bottom of the phone viewport for their own
  // sticky action bar, like a navigation push hiding the tab bar on iOS. The TopNav stays on
  // desktop for pushed screens too.
  // `JobDetail variant="page"` pins an Apply bar to the bottom on phones (< sm): `/jobs/view/`
  // and the static job pages `/jobs/<slug>/`.
  const showApplyBar = pathname.startsWith("/jobs/view") || jobIdFromPath(pathname) !== null;
  const showTabBar = showChrome && !showApplyBar;

  return (
    <ContributorRoot>
    {/* `--ujc-shell-top`: page-level sticky bars (NavBar) sit under the 56px TopNav on desktop. */}
    <div className={cx("flex min-h-dvh flex-col", (showChrome || chromePending) && "md:[--ujc-shell-top:3.5rem]")}>
      {chromePending ? (
        <TopNav
          items={[]}
          activeKey=""
          brand={<BrandMark name={BRAND_NAME} />}
          trailing={
            <div aria-busy="true" className="flex items-center gap-2">
              <Skeleton className="h-8 w-[5.25rem] rounded-full" />
              <Skeleton className="h-8 w-[4.75rem] rounded-full" />
            </div>
          }
        />
      ) : null}
      {showChrome ? (
        <TopNav
          items={publicItems}
          activeKey={activeKey}
          linkAs={Link}
          brand={
            <Link href="/" aria-label={t("brand.homeAriaLabel", { name: BRAND_NAME })} className="rounded-control focus-ring">
              <BrandMark name={BRAND_NAME} />
            </Link>
          }
          trailing={
            <div className="flex items-center gap-2">
              <GitHubLink />
              <ThemeToggle />
              <LanguageSwitch />
              {me ? <ProfileMenuButton currentKey={activeKey} /> : <AccountMenu variant="pill" />}
            </div>
          }
        />
      ) : null}
      {/* Phones: the fixed bottom bar (tab bar, or the job page's Apply bar) must never cover the
          end of the page, so the whole column is padded by its height. No site footer (Slack: "drop
          the extra footer, full-screen home"): source attribution lives in the "N sources" popover. */}
      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col",
          showTabBar && "pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0",
          showApplyBar && "pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-0",
        )}
      >
        <div className="flex-1">{children}</div>
      </div>
      {showTabBar ? <TabBar items={tabItems} activeKey={tabActiveKey} linkAs={Link} /> : null}
      {me ? (
        <ProfileSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          currentKey={activeKey}
          exclude={PHONE_TAB_KEYS}
          extraItems={sheetExtras}
        />
      ) : null}
      {/* Contributor feedback button (D14) wherever the chrome shows; lifted above the phone tab
          bar or the job page's Apply bar so it never covers them. */}
      {showChrome ? (
        <FeedbackWidget
          className={cx(
            showTabBar && "bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-4",
            showApplyBar && "bottom-[calc(100px+env(safe-area-inset-bottom))] sm:bottom-4",
          )}
        />
      ) : null}
    </div>
    </ContributorRoot>
  );
}
