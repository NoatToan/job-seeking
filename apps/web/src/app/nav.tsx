"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SOURCES } from "@ujc/core";
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
  Sidebar,
  TabBar,
} from "@ujc/ui";
import type { NavItem } from "@ujc/ui";
import { isPublicRoute } from "@/lib/public-routes";
import { useSession } from "@/lib/session";

const NAV_ITEMS: NavItem[] = [
  { key: "feed", label: "Feed", href: "/", icon: <BriefcaseIcon size={22} /> },
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
export function AccountMenu({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);

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
      {variant === "row" ? (
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

function Footer() {
  return (
    <footer className="hairline-t px-4 py-6 text-footnote text-label-secondary sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1">
        <p>
          Jobs crawled from We Work Remotely, Greenhouse, Lever, Ashby, Himalayas, Remotive, and{" "}
          <a
            href={SOURCES.adzuna.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-control-sm font-medium text-tint hover:underline focus-ring"
          >
            Jobs by Adzuna
          </a>
          .
        </p>
        <p>Every job links to its original posting.</p>
      </div>
    </footer>
  );
}

/**
 * App shell: Sidebar (>= md) or TabBar (< md), hidden on `/login` and `/design` (both are their
 * own self-contained layouts). Each page renders its own `NavBar`.
 *
 * Signed-in: every nav item. Signed out: only on a public route (home, job detail) — everywhere
 * else, the chrome stays hidden while the page's own content (e.g. `RequireAuth`) handles the
 * redirect to `/login`, same as before this page became reachable signed out. The nav itself
 * only ever shows the "Feed" item (now the public jobs page) plus "Sign in" — Search/Tracker/CV/
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
  // sticky action bar, like a navigation push hiding the tab bar on iOS. The Sidebar stays on
  // desktop, since the desktop shell in SCREENS.md §0 keeps it for pushed screens too.
  const showTabBar = showChrome && !pathname.startsWith("/jobs/view");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {showChrome ? (
        <Sidebar
          items={navItems}
          activeKey={activeKey}
          linkAs={Link}
          header={<BrandMark name="Unified Job Crawler" />}
          footer={<AccountMenu variant="row" />}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cx("flex-1", showTabBar && "pb-[calc(52px+env(safe-area-inset-bottom))] md:pb-0")}>
          {children}
        </div>
        <Footer />
      </div>
      {showTabBar ? <TabBar items={navItems} activeKey={activeKey} linkAs={Link} /> : null}
    </div>
  );
}
