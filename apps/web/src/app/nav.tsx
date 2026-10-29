"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";

/** Primary nav: sign-in link when signed out, or Feed / Live search / My CV + sign-out when in. */
export function Nav() {
  const { me, loading, signOut } = useSession();

  if (loading) return <div className="h-5 w-24" aria-hidden="true" />;

  if (!me) {
    return (
      <Link href="/login/" className="text-sm font-medium underline underline-offset-2">
        Sign in
      </Link>
    );
  }

  return (
    <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
      <Link href="/" className="hover:underline underline-offset-2">
        Feed
      </Link>
      <Link href="/search/" className="hover:underline underline-offset-2">
        Live search
      </Link>
      <Link href="/cv/" className="hover:underline underline-offset-2">
        My CV
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-lg border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Sign out
      </button>
    </nav>
  );
}
