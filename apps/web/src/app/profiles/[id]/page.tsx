import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptedTokens, CANDIDATE_COUNTRIES, DEEP_LINK_SITES } from "@ujc/core";
import { JobCard, SourceBadge } from "@ujc/ui";
import { listJobs, PAGE_SIZE } from "@/lib/jobs";
import { getProfile } from "@/lib/profiles";
import { deleteProfileAction } from "../actions";

async function ProfileMatches({ params, searchParams }: PageProps<"/profiles/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const page = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1;
  const { jobs, total } = await listJobs({
    q: profile.keywords,
    remote: profile.remoteOnly,
    locations: profile.locations,
    sources: profile.sources,
    profileId: profile.id,
    acceptedOpenTo: acceptedTokens(profile.candidateCountry),
    page,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const bySource = Object.entries(
    jobs.reduce<Record<string, number>>((acc, j) => ({ ...acc, [j.source]: (acc[j.source] ?? 0) + 1 }), {}),
  );

  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">{profile.name}</h1>
          <form action={deleteProfileAction}>
            <input type="hidden" name="id" value={profile.id} />
            <button className="text-sm text-red-600 underline">Delete</button>
          </form>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <code>{profile.keywords}</code>
          {profile.locations.length ? ` · ${profile.locations.join(", ")}` : ""}
          {profile.remoteOnly ? " · remote only" : ""}
          {profile.candidateCountry
            ? ` · open to ${CANDIDATE_COUNTRIES.find((c) => c.code === profile.candidateCountry)?.label}`
            : ""}{" "}
          · {total.toLocaleString()} matches
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {bySource.map(([source, n]) => (
            <span key={source} className="flex items-center gap-1">
              <SourceBadge source={source} /> {n}
            </span>
          ))}
          <span className="text-zinc-500">
            · also on{" "}
            {DEEP_LINK_SITES.map((site, i) => (
              <span key={site.label}>
                {i > 0 ? ", " : ""}
                <a href={site.search(profile.keywords)} target="_blank" rel="noopener noreferrer" className="underline">
                  {site.label}
                </a>
              </span>
            ))}
          </span>
        </div>
      </header>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No matches yet. Loosen the keywords, or wait for the next daily crawl.
        </p>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
      {pages > 1 ? (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={`/profiles/${profile.id}?page=${page - 1}`}>← Previous</Link> : <span />}
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={`/profiles/${profile.id}?page=${page + 1}`}>Next →</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}

export default function ProfilePage(props: PageProps<"/profiles/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <Link href="/profiles" className="text-sm underline">
        ← Profiles
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Matching jobs…</p>}>
        <ProfileMatches {...props} />
      </Suspense>
    </main>
  );
}
