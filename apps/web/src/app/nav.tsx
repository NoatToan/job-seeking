"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Avatar,
  BrandMark,
  BriefcaseIcon,
  buttonClasses,
  cx,
  DocumentIcon,
  GroupedList,
  KanbanIcon,
  LinkIcon,
  ListRow,
  SearchIcon,
  Sheet,
  TabBar,
  TopNav,
} from "@ujc/ui";
import type { NavItem } from "@ujc/ui";
import { LanguageSwitch } from "@/lib/i18n/provider";
import { isPublicRoute } from "@/lib/public-routes";
import { useSession } from "@/lib/session";

/** Blog tab icon (a newspaper; same 24px stroke style as the @ujc/ui icons). */
function NewspaperIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v9.5a2 2 0 0 1-4 0M7.5 9h6M7.5 12.5h6M7.5 16h4" />
    </svg>
  );
}

/** Product name shown in the chrome (the repo is "job-seeking"; "crawler" read like an internal tool). */
export const BRAND_NAME = "JobSeeking";

function useNavItems(): NavItem[] {
  const { t, i18n } = useTranslation("common");
  return useMemo(
    () => [
      { key: "feed", label: t("nav.jobs"), href: "/", icon: <BriefcaseIcon size={22} /> },
      { key: "search", label: t("nav.liveSearch"), href: "/search/", icon: <SearchIcon size={22} /> },
      { key: "tracker", label: t("nav.tracker"), href: "/tracker/", icon: <KanbanIcon size={22} /> },
      { key: "cv", label: t("nav.myCv"), href: "/cv/", icon: <DocumentIcon size={22} /> },
      { key: "connections", label: t("nav.connections"), href: "/connections/", icon: <LinkIcon size={22} /> },
      { key: "blog", label: t("nav.blog"), href: "/blog/", icon: <NewspaperIcon /> },
    ],
    // `t` keeps its identity across language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.resolvedLanguage],
  );
}

function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/tracker")) return "tracker";
  if (pathname.startsWith("/cv")) return "cv";
  if (pathname.startsWith("/connections")) return "connections";
  if (pathname.startsWith("/blog")) return "blog";
  if (pathname === "/") return "feed";
  return "";
}

/**
 * Avatar/initial trigger that opens an account Sheet with "Sign out". `variant="row"` renders
 * the name + email row used in the Sidebar footer; `variant="icon"` is a compact trigger for the
 * NavBar trailing slot on phones (the Sidebar footer already covers desktop).
 */
export function AccountMenu({ variant = "icon" }: { variant?: "icon" | "row" | "pill" }) {
  const { me, signOut } = useSession();
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  if (!me && variant === "pill") {
    return (
      <Link href="/login/" className={buttonClasses({ variant: "tinted", size: "sm", className: "rounded-full px-4" })}>
        {t("nav.signIn")}
      </Link>
    );
  }

  if (!me) {
    return (
      <Link
        href="/login/"
        className={buttonClasses({ variant: variant === "row" ? "gray" : "tinted", size: "sm", fullWidth: variant === "row" })}
      >
        {t("nav.signIn")}
      </Link>
    );
  }

  return (
    <>
      {variant === "pill" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("nav.accountOf", { email: me.user.email })}
          className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors duration-150 hover:bg-fill-tertiary focus-ring"
        >
          <Avatar name={me.user.email} size={30} />
          <span className="max-w-[12rem] truncate text-subheadline font-medium text-label">{me.user.email}</span>
        </button>
      ) : variant === "row" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors duration-150 hover:bg-fill-tertiary focus-ring"
        >
          <Avatar name={me.user.email} size={32} />
          <span className="min-w-0 flex-1 truncate text-subheadline font-semibold text-label">
            {me.user.email}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("nav.accountOf", { email: me.user.email })}
          className="relative rounded-full focus-ring"
        >
          <Avatar name={me.user.email} size={32} />
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title={t("nav.account")} description={me.user.email}>
        <GroupedList label={t("nav.accountOptions")}>
          <ListRow
            title={t("nav.accountPrivacy")}
            href="/account/"
            linkAs={Link}
            onClick={() => setOpen(false)}
          />
          <ListRow
            title={t("nav.signOut")}
            destructive
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          />
        </GroupedList>
      </Sheet>
    </>
  );
}

/**
 * App shell: TopNav (>= md) or TabBar (< md), hidden on `/login` and `/design` (both are their
 * own self-contained layouts). Each page renders its own `NavBar`.
 *
 * Signed-in: every nav item. Signed out: only on a public route (home, job detail) — everywhere
 * else, the chrome stays hidden while the page's own content (e.g. `RequireAuth`) handles the
 * redirect to `/login`, same as before this page became reachable signed out. The nav itself
 * only ever shows the "Jobs" item (now the public jobs page) plus "Sign in" — Search/Tracker/CV/
 * Connections all need a session, so they would just be dead ends for an anonymous visitor.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const { t } = useTranslation("common");
  const allItems = useNavItems();
  const pathname = usePathname() ?? "/";
  const bareRoute =
    pathname.startsWith("/login") || pathname.startsWith("/design") || pathname.startsWith("/onboarding");
  const showChrome = !loading && !bareRoute && (Boolean(me) || isPublicRoute(pathname));
  // Signed out: the public pages only (jobs, blog).
  const navItems = me ? allItems : allItems.filter((item) => item.key === "feed" || item.key === "blog");
  // The phone tab bar keeps its five signed-in tabs; the blog stays reachable from the TopNav.
  const tabItems = me ? navItems.filter((item) => item.key !== "blog") : navItems;
  const activeKey = activeKeyFor(pathname);
  // Pushed detail screens (job detail) own the bottom of the phone viewport for their own
  // sticky action bar, like a navigation push hiding the tab bar on iOS. The TopNav stays on
  // desktop for pushed screens too.
  const showTabBar = showChrome && !pathname.startsWith("/jobs/view");
  // `JobDetail variant="page"` pins an Apply bar to the bottom on phones (< sm).
  const showApplyBar = pathname.startsWith("/jobs/view");

  return (
    // `--ujc-shell-top`: page-level sticky bars (NavBar) sit under the 56px TopNav on desktop.
    <div className={cx("flex min-h-dvh flex-col", showChrome && "md:[--ujc-shell-top:3.5rem]")}>
      {showChrome ? (
        <TopNav
          items={navItems}
          activeKey={activeKey}
          linkAs={Link}
          brand={
            <Link href="/" aria-label={t("brand.homeAriaLabel", { name: BRAND_NAME })} className="rounded-control focus-ring">
              <BrandMark name={BRAND_NAME} />
            </Link>
          }
          trailing={
            <div className="flex items-center gap-2">
              <LanguageSwitch />
              <AccountMenu variant="pill" />
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
      {showTabBar ? <TabBar items={tabItems} activeKey={activeKey} linkAs={Link} /> : null}
    </div>
  );
}
