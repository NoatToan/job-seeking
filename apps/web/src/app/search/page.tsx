import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX } from "@/lib/site";
import { LiveSearch } from "./live-search";

export const metadata: Metadata = { title: "Live search", robots: NO_INDEX };

// `LiveSearch` reads `?q=` / `?off=` (nuqs), so it renders in the browser under Suspense.
export default function SearchPage() {
  return (
    <Suspense fallback={<p className="px-4 py-8 text-body text-label-secondary">Loading…</p>}>
      <LiveSearch />
    </Suspense>
  );
}
