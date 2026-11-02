import { Suspense } from "react";
import { Connections } from "./connections";

export default function Page() {
  return (
    <Suspense
      fallback={<p className="mx-auto w-full max-w-2xl px-4 py-12 text-sm text-zinc-500">Loading…</p>}
    >
      <Connections />
    </Suspense>
  );
}
