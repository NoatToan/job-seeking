"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/session";
import { setViewedSignedIn, syncViewed } from "@/lib/viewed";

/** Keeps the read-jobs history in sync with the account while signed in (lib/viewed.ts):
 * on sign-in it pulls the account's history and pushes what was read in this browser. */
export function ViewedSync() {
  const { me } = useSession();
  const userId = me?.user.id ?? null;
  useEffect(() => {
    setViewedSignedIn(userId !== null);
    if (userId !== null) void syncViewed().catch(() => {});
  }, [userId]);
  return null;
}
