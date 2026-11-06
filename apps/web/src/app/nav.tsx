"use client";

import { useState } from "react";
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
import { isPublicRoute } from "@/lib/public-routes";
import { useSession } from "@/lib/session";

/** Product name shown in the chrome (the repo is "job-seeking"; "crawler" read like an internal tool). */
export const BRAND_NAME = "JobSeeking";

const NAV_ITEMS: NavItem[] = [
  { key: "feed", label: "Jobs", href: "/", icon: <BriefcaseIcon size={22} /> },
  { key: "search", label: "Live search", href: "/search/", icon: <SearchIcon size={22} /> },
  { key: "tracker", label: "Tracker", href: "/tracker/", icon: <KanbanIcon size={22} /> },
  { key: "cv", label: "My CV", href: "/cv/", icon: <DocumentIcon size={22} /> },
  { key: "connections", label: "Connections", href: "/connections/", icon: <LinkIcon size={22} /> },
];

function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/tracker")) return "tracker";
  if (pathname.startsWith("/cv")) return "cv";
  if (pathname.startsWith("/connections")) return "connections";
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
  const [open, setOpen] = useState(false);

  if (!me && variant === "pill") {
    return (
      <Link href="/login/" className={buttonClasses({ variant: "tinted", size: "sm", className: "rounded-full px-4" })}>
        Sign in
      </Link>
    );
  }

  if (!me) {
    return (
      <Link
        href="/login/"
        className={buttonClasses({ variant: variant === "row" ? "gray" : "tinted", size: "sm", fullWidth: variant === "row" })}
      >
        Sign in
      </Link>
    );
  }

  return (
    <>
      {variant === "pill" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Account: ${me.user.email}`}
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
          aria-label={`Account: ${me.user.email}`}
          className="relative rounded-full focus-ring"
        >
          <Avatar name={me.user.email} size={32} />
        </button>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Account" description={me.user.email}>
        <GroupedList label="Account options">
          <ListRow
            title="Account & privacy"
            href="/account/"
            linkAs={Link}
            onClick={() => setOpen(false)}
          />
          <ListRow
            title="Sign out"
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
  const pathname = usePathname() ?? "/";
  const bareRoute =
    pathname.startsWith("/login") || pathname.startsWith("/design") || pathname.startsWith("/onboarding");
  const showChrome = !loading && !bareRoute && (Boolean(me) || isPublicRoute(pathname));
  const navItems = me ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.key === "feed");
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
            <Link href="/" aria-label={`${BRAND_NAME} home`} className="rounded-control focus-ring">
              <BrandMark name={BRAND_NAME} />
            </Link>
          }
          trailing={<AccountMenu variant="pill" />}
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
      {showTabBar ? <TabBar items={navItems} activeKey={activeKey} linkAs={Link} /> : null}
    </div>
  );
}
