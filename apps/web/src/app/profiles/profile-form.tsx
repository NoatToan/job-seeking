"use client";

import { useActionState } from "react";
import { CANDIDATE_COUNTRIES, SOURCE_IDS, sourceMeta } from "@ujc/core";
import { createProfileAction } from "./actions";

const input =
  "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function ProfileForm() {
  const [state, action, pending] = useActionState(createProfileAction, {});
  return (
    <form action={action} className="grid gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-semibold">New search profile</h2>
      <label className="grid gap-1 text-sm">
        Name
        <input name="name" required maxLength={80} placeholder="Senior React (AU / remote)" className={input} />
      </label>
      <label className="grid gap-1 text-sm">
        Keywords
        <input
          name="keywords"
          required
          maxLength={300}
          placeholder='react typescript -intern  ·  "react native" OR flutter'
          className={input}
        />
        <span className="text-xs text-zinc-500">Words must all match; use quotes for phrases, OR, and -word to exclude.</span>
      </label>
      <label className="grid gap-1 text-sm">
        Locations (comma separated, optional)
        <input name="locations" placeholder="Sydney, Melbourne, Vietnam" className={input} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="remoteOnly" /> Remote only
      </label>
      <label className="grid gap-1 text-sm">
        I&apos;m based in (hides remote jobs not open to this country)
        <select name="candidateCountry" defaultValue="" className={input}>
          <option value="">Don&apos;t filter</option>
          {CANDIDATE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="mb-1">Sources (none = all)</legend>
        {SOURCE_IDS.map((id) => (
          <label key={id} className="flex items-center gap-1">
            <input type="checkbox" name="sources" value={id} /> {sourceMeta(id).label}
          </label>
        ))}
      </fieldset>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button
        disabled={pending}
        className="justify-self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Saving…" : "Save and show matches"}
      </button>
    </form>
  );
}
