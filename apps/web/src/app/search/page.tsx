import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX } from "@/lib/site";
import { LiveSearch } from "./live-search";
import { LiveSearchPageSkeleton } from "@/app/skeletons";

export const metadata: Metadata = { title: "Live search", robots: NO_INDEX };

// `LiveSearch` reads `?q=` / `?off=` (nuqs), so it renders in the browser under Suspense.
export default function SearchPage() {
  return (
    <Suspense fallback={<LiveSearchPageSkeleton />}>
      <LiveSearch />
    </Suspense>
  );
}
