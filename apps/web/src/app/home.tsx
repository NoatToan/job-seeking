"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";
import { SegmentedControl } from "@ujc/ui";
import { Feed } from "./feed";
import { PublicJobs } from "./public-jobs";
import { useSession } from "@/lib/session";
import { homeModeParser } from "@/lib/url-state";

export type HomeMode = "all" | "matches";

const MODE_KEY = "ujc:home-mode";

function readMode(): HomeMode | null {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "all" || v === "matches" ? v : null;
  } catch {
    return null;
  }
}

/** "All jobs | For you" switch shown in the home hero when signed in. */
export function HomeModeSwitch({ value, onChange }: { value: HomeMode; onChange: (m: HomeMode) => void }) {
  return (
    <SegmentedControl
      label="Which jobs"
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: "All jobs" },
        { value: "matches", label: "For you" },
      ]}
    />
  );
}

/**
 * `/`: signed out, the public job catalogue (`PublicJobs`). Signed in, a choice (Slack request:
 * "after signing in the filter shows too few jobs and I haven't uploaded a CV — add a free search
 * mode that doesn't match my profile"):
 *  - "All jobs": the same whole catalogue, free search, with Track and synced read history;
 *  - "For you": the personalised `Feed` (keywords, remote / country preferences, CV scores).
 * `?view=all|matches` picks one (shareable); otherwise the last choice in this browser, else "For you"
 * once there is a CV, else "All jobs".
 * Neither branch renders until the initial `GET /api/me` check resolves, so a signed-in visitor
 * never flashes the public list first.
 */
export function Home() {
  const { me, loading } = useSession();
  const [urlMode, setUrlMode] = useQueryState("view", homeModeParser);
  const [stored, setStored] = useState<HomeMode | null>(() => (typeof window === "undefined" ? null : readMode()));

  if (loading) {
    return <p className="px-4 py-8 text-body text-label-secondary">Loading…</p>;
  }
  if (!me) return <PublicJobs />;

  const mode: HomeMode = urlMode ?? stored ?? (me.latestCv ? "matches" : "all");
  const setMode = (m: HomeMode) => {
    setStored(m);
    void setUrlMode(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // Storage disabled: the choice lasts for this visit only.
    }
  };
  const modeSwitch = <HomeModeSwitch value={mode} onChange={setMode} />;
  return mode === "all" ? <PublicJobs signedIn modeSwitch={modeSwitch} /> : <Feed modeSwitch={modeSwitch} />;
}
