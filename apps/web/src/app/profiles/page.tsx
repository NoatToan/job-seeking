import { Suspense } from "react";
import Link from "next/link";
import { sourceMeta } from "@ujc/core";
import { listProfiles } from "@/lib/profiles";
import { ProfileForm } from "./profile-form";

async function ProfileList() {
  const profiles = await listProfiles();
  if (profiles.length === 0) return <p className="text-sm text-zinc-500">No profiles yet.</p>;
  return (
    <ul className="grid gap-2">
      {profiles.map((p) => (
        <li key={p.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <Link href={`/profiles/${p.id}`} className="font-medium hover:underline">
            {p.name}
          </Link>
          <p className="text-xs text-zinc-500">
            {p.keywords}
            {p.locations.length ? ` · ${p.locations.join(", ")}` : ""}
            {p.remoteOnly ? " · remote only" : ""}
            {p.sources.length ? ` · ${p.sources.map((s) => sourceMeta(s).label).join(", ")}` : " · all sources"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function ProfilesPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Search profiles</h1>
        <Link href="/" className="text-sm underline">
          All jobs
        </Link>
      </header>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A profile is what you are looking for. Every daily crawl maps new jobs to it, ranked by relevance, with the
        source of each job.
      </p>
      <ProfileForm />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading profiles…</p>}>
        <ProfileList />
      </Suspense>
    </main>
  );
}
