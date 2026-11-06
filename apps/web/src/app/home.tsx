"use client";

import { Feed } from "./feed";
import { PublicJobs } from "./public-jobs";
import { useSession } from "@/lib/session";

/**
 * `/`: the personalised `Feed` when signed in, the public job catalogue (`PublicJobs`) otherwise
 * (Slack request — "without logging in, the home page should still show all the jobs we have").
 * Neither branch renders until the initial `GET /api/me` check resolves, so a signed-in visitor
 * never flashes the public list first.
 */
export function Home() {
  const { me, loading } = useSession();

  if (loading) {
    return <p className="px-4 py-8 text-body text-label-secondary">Loading…</p>;
  }

  return me ? <Feed /> : <PublicJobs />;
}
