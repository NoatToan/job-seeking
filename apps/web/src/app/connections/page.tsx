import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX } from "@/lib/site";
import { Connections } from "./connections";

export const metadata: Metadata = { title: "Connections", robots: NO_INDEX };

export default function Page() {
  return (
    <Suspense
      fallback={<p className="mx-auto w-full max-w-2xl px-4 py-12 text-sm text-zinc-500">Loading…</p>}
    >
      <Connections />
    </Suspense>
  );
}
