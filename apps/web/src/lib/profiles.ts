import "server-only";
import { connection } from "next/server";
import { acceptedTokens, isSourceId } from "@ujc/core";
import { db } from "./db";

export interface SearchProfile {
  id: string;
  name: string;
  keywords: string;
  locations: string[];
  remoteOnly: boolean;
  sources: string[];
  candidateCountry: string | null;
  createdAt: string;
}

export interface ProfileInput {
  name: string;
  keywords: string;
  locations: string[];
  remoteOnly: boolean;
  sources: string[];
  candidateCountry: string | null;
}

/** Validates raw form input; returns the cleaned profile or an error message. */
export function parseProfileInput(form: FormData): ProfileInput | { error: string } {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const name = text("name").slice(0, 80);
  const keywords = text("keywords").slice(0, 300);
  if (!name) return { error: "Name is required." };
  if (!keywords) return { error: "Keywords are required." };
  const locations = text("locations")
    .split(",")
    .map((l) => l.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 10);
  const sources = form.getAll("sources").map(String).filter(isSourceId);
  const country = text("candidateCountry");
  return {
    name,
    keywords,
    locations,
    remoteOnly: form.get("remoteOnly") === "on",
    sources,
    candidateCountry: acceptedTokens(country) ? country : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProfile(r: any): SearchProfile {
  return {
    id: String(r.id),
    name: r.name,
    keywords: r.keywords,
    locations: r.locations ?? [],
    remoteOnly: r.remote_only,
    sources: r.sources ?? [],
    candidateCountry: r.candidate_country ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listProfiles(): Promise<SearchProfile[]> {
  await connection();
  const rows = await db()`SELECT * FROM search_profiles ORDER BY created_at DESC LIMIT 200`;
  return rows.map(toProfile);
}

export async function getProfile(id: string): Promise<SearchProfile | null> {
  await connection();
  if (!/^\d+$/.test(id)) return null;
  const [row] = await db()`SELECT * FROM search_profiles WHERE id = ${id}`;
  return row ? toProfile(row) : null;
}

export async function createProfile(p: ProfileInput): Promise<string> {
  const [row] = await db()`
    INSERT INTO search_profiles (name, keywords, locations, remote_only, sources, candidate_country)
    VALUES (${p.name}, ${p.keywords}, ${p.locations}, ${p.remoteOnly}, ${p.sources}, ${p.candidateCountry})
    RETURNING id`;
  return String(row.id);
}

export async function deleteProfile(id: string): Promise<void> {
  if (!/^\d+$/.test(id)) return;
  await db()`DELETE FROM search_profiles WHERE id = ${id}`;
}
