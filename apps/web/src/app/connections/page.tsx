import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX } from "@/lib/site";
import { Connections } from "./connections";
import { ConnectionsPageSkeleton } from "@/app/skeletons";

export const metadata: Metadata = { title: "Connections", robots: NO_INDEX };

export default function Page() {
  return (
    <Suspense fallback={<ConnectionsPageSkeleton />}>
      <Connections />
    </Suspense>
  );
}
