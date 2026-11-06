"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import type { MeResponse } from "@ujc/core";
import {
  Avatar,
  cx,
  DocumentIcon,
  FloatingPanel,
  GroupedList,
  KanbanIcon,
  LinkIcon,
  ListRow,
  SearchIcon,
  Sheet,
  SparklesIcon,
  UserIcon,
} from "@ujc/ui";
import { ThemePicker } from "@/lib/theme";
import { useSession } from "@/lib/session";

/** The name the app shows for the signed-in user: their profile display name, else the email. */
export function displayNameOf(user: MeResponse["user"]): string {
  return user.displayName?.trim() || user.email;
}

export interface ProfileMenuItem {
  key: string;
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface ProfileMenuGroup {
  key: string;
  label: string;
  items: ProfileMenuItem[];
}

/** Which profile-menu entry (if any) the current path belongs to. */
export function profileMenuKeyFor(pathname: string): string {
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/tracker")) return "tracker";
  if (pathname.startsWith("/cv")) return "cv";
  if (pathname.startsWith("/connections")) return "connections";
  if (pathname.startsWith("/contribute")) return "contribute";
  if (pathname.startsWith("/admin/feedback")) return "adminFeedback";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/account")) return "account";
  return "";
}

/**
 * Everything personal, grouped: the job-search tools (all need a session — Live search included,
 * it runs the user's own sources and per-user rate limit), the Contributor screens, then the
 * account. `exclude` drops entries the caller already shows elsewhere (the phone tab bar owns
 * Tracker and CV).
 */
export function useProfileMenuGroups(exclude: ReadonlyArray<string> = []): ProfileMenuGroup[] {
  const { me } = useSession();
  const { t, i18n } = useTranslation("common");
  const { t: tc } = useTranslation("contributor");
  const isAdmin = me?.user.role === "admin";
  const excludeKey = exclude.join(",");
  return useMemo(() => {
    const groups: ProfileMenuGroup[] = [
      {
        key: "jobSearch",
        label: t("nav.menuJobSearch"),
        items: [
          { key: "forYou", label: t("nav.forYou"), href: "/?view=matches", icon: <SparklesIcon size={18} /> },
          { key: "search", label: t("nav.liveSearch"), href: "/search/", icon: <SearchIcon size={18} /> },
          { key: "tracker", label: t("nav.tracker"), href: "/tracker/", icon: <KanbanIcon size={18} /> },
          { key: "cv", label: t("nav.myCv"), href: "/cv/", icon: <DocumentIcon size={18} /> },
          { key: "connections", label: t("nav.connections"), href: "/connections/", icon: <LinkIcon size={18} /> },
        ],
      },
      {
        key: "community",
        label: t("nav.menuCommunity"),
        items: [
          { key: "contribute", label: tc("nav.contribute"), href: "/contribute/" },
          ...(isAdmin ? [{ key: "adminFeedback", label: tc("nav.reviewFeedback"), href: "/admin/feedback/" }] : []),
        ],
      },
      {
        key: "account",
        label: t("nav.menuAccount"),
        items: [
          { key: "profile", label: t("nav.editProfile"), href: "/profile/", icon: <UserIcon size={18} /> },
          { key: "account", label: t("nav.accountPrivacy"), href: "/account/" },
        ],
      },
    ];
    const skip = new Set(excludeKey ? excludeKey.split(",") : []);
    return groups
      .map((g) => ({ ...g, items: g.items.filter((item) => !skip.has(item.key)) }))
      .filter((g) => g.items.length > 0);
    // `t` keeps its identity across language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tc, i18n.resolvedLanguage, isAdmin, excludeKey]);
}

function MenuHeader({ user }: { user: MeResponse["user"] }) {
  const name = displayNameOf(user);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} size={40} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-headline text-label">{name}</span>
        {user.headline ? <span className="truncate text-footnote text-label-secondary">{user.headline}</span> : null}
        {name !== user.email ? <span className="truncate text-footnote text-label-secondary">{user.email}</span> : null}
      </div>
    </div>
  );
}

/**
 * Desktop (>= md) profile menu: an avatar button (menu button pattern) opening a popover menu.
 * Keyboard: Enter / Space / ArrowDown open on the first item, ArrowUp on the last; inside,
 * ArrowUp/ArrowDown move (wrapping), Home/End jump, Esc closes and returns focus to the avatar,
 * Tab closes and lets focus move on. `current` gives the avatar an active ring when the page on
 * screen is one of the menu's places (the matching item is marked `aria-current`).
 */
export function ProfileMenuButton({ currentKey }: { currentKey: string }) {
  const { me, signOut } = useSession();
  const { t } = useTranslation("common");
  const groups = useProfileMenuGroups();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Which item to focus once the menu has rendered: "first" | "last".
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const menuId = useId();
  const active = groups.some((g) => g.items.some((item) => item.key === currentKey));

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    // Wait one frame: FloatingPanel measures and positions itself before it is focusable.
    const frame = requestAnimationFrame(() => {
      const list = items();
      if (pendingFocus.current === "last") list[list.length - 1]?.focus();
      else list[0]?.focus();
      pendingFocus.current = null;
    });
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!me) return null;
  const name = displayNameOf(me.user);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      pendingFocus.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // The menu is in a portal at the end of <body>: send focus back to the avatar so Tab
        // continues from there, as if the menu were inline.
        e.preventDefault();
        close(true);
        break;
      default:
        break;
    }
  };

  const itemClass =
    "flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-subheadline outline-none transition-colors duration-100 hover:bg-fill-tertiary focus-visible:bg-fill-tertiary focus:bg-fill-tertiary";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("nav.openProfileMenu", { name })}
        onClick={() => {
          pendingFocus.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKeyDown}
        data-active={active || undefined}
        className={cx(
          "relative rounded-full p-0.5 transition-shadow duration-150 focus-ring",
          // Active ring: the page on screen lives inside this menu.
          active ? "ring-2 ring-tint" : "ring-1 ring-separator hover:ring-label-tertiary",
        )}
      >
        <Avatar name={name} size={30} />
      </button>
      <FloatingPanel
        anchorRef={buttonRef}
        open={open}
        align="end"
        id={menuId}
        role="menu"
        aria-label={t("nav.profileMenu")}
        panelRef={menuRef}
        className="w-72 rounded-[18px] border border-separator bg-background p-1.5 shadow-overlay"
      >
        <div onKeyDown={onMenuKeyDown}>
          <div role="none" className="px-2.5 pt-2 pb-2.5">
            <MenuHeader user={me.user} />
          </div>
          {groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="hairline-t py-1">
              {group.items.map((item) => {
                const current = item.key === currentKey;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={current ? "page" : undefined}
                    onClick={() => close(false)}
                    className={cx(itemClass, current ? "font-semibold text-tint-ink" : "text-label")}
                  >
                    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-label-secondary">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {current ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-tint" /> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div role="none" className="hairline-t pt-1">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                void signOut();
              }}
              className={cx(itemClass, "text-danger-ink")}
            >
              <span aria-hidden className="size-5 shrink-0" />
              {t("nav.signOut")}
            </button>
          </div>
        </div>
      </FloatingPanel>
    </>
  );
}

/**
 * Phone (< md) profile sheet, opened from the tab bar's "Profile" tab: the same places as the
 * desktop menu minus the ones that already have a tab, the Roadmap (public, but the signed-in tab
 * bar has no room for it), the theme picker and Sign out. Esc, the scrim and the close button
 * close it; focus returns to the tab (Sheet).
 */
export function ProfileSheet({
  open,
  onClose,
  currentKey,
  exclude,
  extraItems,
}: {
  open: boolean;
  onClose: () => void;
  currentKey: string;
  exclude?: ReadonlyArray<string>;
  /** Public places with no tab of their own (Roadmap, later Release notes). */
  extraItems?: ReadonlyArray<ProfileMenuItem>;
}) {
  const { me, signOut } = useSession();
  const { t } = useTranslation("common");
  const groups = useProfileMenuGroups(exclude);
  if (!me) return null;
  return (
    <Sheet open={open} onClose={onClose} title={t("nav.profile")}>
      <div className="mb-5 rounded-card bg-grouped-secondary p-4 shadow-card">
        <MenuHeader user={me.user} />
      </div>
      {groups.map((group) => (
        <GroupedList key={group.key} header={group.label} className="mb-5">
          {group.items.map((item) => (
            <ListRow
              key={item.key}
              title={item.label}
              href={item.href}
              linkAs={Link}
              current={item.key === currentKey}
              onClick={onClose}
            />
          ))}
          {group.key === "community"
            ? extraItems?.map((item) => (
                <ListRow
                  key={item.key}
                  title={item.label}
                  href={item.href}
                  linkAs={Link}
                  current={item.key === currentKey}
                  onClick={onClose}
                />
              ))
            : null}
        </GroupedList>
      ))}
      <GroupedList header={t("theme.label")} className="mb-5">
        <li className="p-3">
          <ThemePicker className="w-full" />
        </li>
      </GroupedList>
      <GroupedList label={t("nav.accountOptions")}>
        <ListRow
          title={t("nav.signOut")}
          destructive
          onClick={() => {
            onClose();
            void signOut();
          }}
        />
      </GroupedList>
    </Sheet>
  );
}
