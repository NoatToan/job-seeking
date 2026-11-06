"use client";

import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MeResponse, UserProfile, UserProfilePatch } from "@ujc/core";
import { CANDIDATE_COUNTRIES } from "@ujc/core";
import { Avatar, Button, Chip, NavBar, Skeleton, TextField, Toggle, useToast } from "@ujc/ui";
import { ApiError, getProfile, updateProfile } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { timezoneOptions } from "@/lib/user-timezone";
import { displayNameOf } from "@/app/profile-menu";

const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LEN = 40;

type LinkKey = keyof UserProfile["links"];
const LINK_HOSTS: Record<LinkKey, string | null> = { linkedin: "linkedin.com", github: "github.com", website: null };

/** Client-side mirror of the API's link rule: empty, or an absolute https URL (on `host`). */
export function linkProblem(value: string, host: string | null): "invalid" | "wrongHost" | null {
  const v = value.trim();
  if (!v) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || /\s/.test(v)) {
    return "invalid";
  }
  if (host && url.hostname !== host && !url.hostname.endsWith(`.${host}`)) return "wrongHost";
  return null;
}

/** Text fields: "" in the form, `null` on the wire. */
function toWire(value: string): string | null {
  const v = value.trim().replace(/\s+/g, " ");
  return v ? v : null;
}

/** Only the keys whose value differs from `saved` (so a PATCH never rewrites untouched fields). */
export function diffProfile(saved: UserProfile, draft: UserProfile): UserProfilePatch {
  const patch: UserProfilePatch = {};
  if (draft.displayName !== saved.displayName) patch.displayName = draft.displayName;
  if (draft.headline !== saved.headline) patch.headline = draft.headline;
  if (draft.candidateCountry !== saved.candidateCountry) patch.candidateCountry = draft.candidateCountry;
  if (draft.timeZone !== saved.timeZone) patch.timeZone = draft.timeZone;
  if (draft.remoteOnly !== saved.remoteOnly) patch.remoteOnly = draft.remoteOnly;
  if (draft.keywords.join("\n") !== saved.keywords.join("\n")) patch.keywords = draft.keywords;
  const links: Partial<UserProfile["links"]> = {};
  for (const key of Object.keys(LINK_HOSTS) as LinkKey[]) {
    if (draft.links[key] !== saved.links[key]) links[key] = draft.links[key];
  }
  if (Object.keys(links).length) patch.links = links;
  return patch;
}

/** The session's copy of what the profile changes (menu name, greeting, feed preferences). */
function applyToMe(me: MeResponse, p: UserProfile): MeResponse {
  return {
    ...me,
    user: { ...me.user, displayName: p.displayName, headline: p.headline },
    preferences: {
      ...me.preferences,
      candidateCountry: p.candidateCountry,
      digestTz: p.timeZone,
      keywords: p.keywords,
      remoteOnly: p.remoteOnly,
    },
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
      <h2 className="text-headline text-label">{title}</h2>
      {children}
    </section>
  );
}

function SelectRow({
  id,
  label,
  hint,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-subheadline font-medium text-label">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11 w-full rounded-control border border-control-border bg-background px-3 text-body text-label focus-ring"
      >
        {children}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="text-footnote text-label-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ProfileForm({ initial }: { initial: UserProfile }) {
  const { t } = useTranslation("account");
  const { me, mutate } = useSession();
  const toast = useToast();
  const [saved, setSaved] = useState<UserProfile>(initial);
  const [draft, setDraft] = useState<UserProfile>(initial);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => timezoneOptions(draft.timeZone), [draft.timeZone]);

  const linkErrors = Object.fromEntries(
    (Object.keys(LINK_HOSTS) as LinkKey[]).map((key) => {
      const problem = linkProblem(draft.links[key] ?? "", LINK_HOSTS[key]);
      const message =
        problem === "invalid"
          ? t("profile.links.invalid")
          : problem === "wrongHost"
            ? t("profile.links.wrongHost", { host: LINK_HOSTS[key] })
            : null;
      return [key, message];
    }),
  ) as Record<LinkKey, string | null>;
  const hasErrors = Object.values(linkErrors).some(Boolean);
  // Compare normalised values, so trailing spaces alone don't count as a change.
  const normalised: UserProfile = {
    ...draft,
    displayName: toWire(draft.displayName ?? ""),
    headline: toWire(draft.headline ?? ""),
    links: {
      linkedin: toWire(draft.links.linkedin ?? ""),
      github: toWire(draft.links.github ?? ""),
      website: toWire(draft.links.website ?? ""),
    },
  };
  const patch = diffProfile(saved, normalised);
  const dirty = Object.keys(patch).length > 0;

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setLink = (key: LinkKey, value: string) => setDraft((d) => ({ ...d, links: { ...d.links, [key]: value } }));

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k) return;
    if (k.length > MAX_KEYWORD_LEN) return;
    if (draft.keywords.length >= MAX_KEYWORDS) {
      setKeywordError(t("profile.prefs.tooMany"));
      return;
    }
    if (!draft.keywords.some((x) => x.toLowerCase() === k.toLowerCase())) set("keywords", [...draft.keywords, k]);
    setKeywordInput("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (hasErrors) {
      toast.show({ tone: "error", title: t("profile.fixErrors") });
      return;
    }
    if (!dirty) {
      toast.show({ tone: "info", title: t("profile.nothingChanged") });
      return;
    }
    // Optimistic: the new name/preferences show everywhere at once (menu, greeting, feed);
    // rolled back if the server refuses.
    const previous = saved;
    const previousMe = me;
    setSaved(normalised);
    setDraft(normalised);
    mutate((m) => applyToMe(m, normalised));
    setSaving(true);
    try {
      const { profile } = await updateProfile(patch);
      setSaved(profile);
      setDraft(profile);
      mutate((m) => applyToMe(m, profile));
      toast.show({ tone: "success", title: t("profile.savedToast") });
    } catch (err) {
      setSaved(previous);
      setDraft(previous);
      if (previousMe) mutate(() => previousMe);
      toast.show({
        tone: "error",
        title: t("profile.saveFailedTitle"),
        message: err instanceof ApiError ? `${err.message} ${t("profile.reverted")}` : t("profile.reverted"),
      });
    } finally {
      setSaving(false);
    }
  }

  const avatarName = normalised.displayName ?? me?.user.email ?? "?";

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
      <section className="flex items-center gap-4 rounded-card bg-grouped-secondary p-4 shadow-card">
        <Avatar name={avatarName} size={64} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-title3 font-semibold text-label">{me ? displayNameOf({ ...me.user, displayName: normalised.displayName }) : ""}</p>
          {normalised.headline ? <p className="truncate text-subheadline text-label-secondary">{normalised.headline}</p> : null}
          <p className="text-footnote text-label-tertiary">{t("profile.avatarHint")}</p>
        </div>
      </section>

      <Section title={t("profile.about.header")}>
        <TextField
          id="profile-display-name"
          label={t("profile.about.displayName")}
          hint={t("profile.about.displayNameHint")}
          value={draft.displayName ?? ""}
          maxLength={60}
          autoComplete="name"
          onChange={(e) => set("displayName", e.target.value)}
        />
        <TextField
          id="profile-headline"
          label={t("profile.about.headline")}
          hint={t("profile.about.headlineHint")}
          placeholder={t("profile.about.headlinePlaceholder")}
          value={draft.headline ?? ""}
          maxLength={120}
          onChange={(e) => set("headline", e.target.value)}
        />
      </Section>

      <Section title={t("profile.location.header")}>
        <SelectRow
          id="profile-country"
          label={t("profile.location.basedIn")}
          hint={t("profile.location.basedInHint")}
          value={draft.candidateCountry ?? ""}
          onChange={(v) => set("candidateCountry", v || null)}
        >
          <option value="">{t("profile.location.selectCountry")}</option>
          {CANDIDATE_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </SelectRow>
        <SelectRow
          id="profile-timezone"
          label={t("profile.location.timeZone")}
          hint={t("profile.location.timeZoneHint")}
          value={draft.timeZone}
          onChange={(v) => set("timeZone", v)}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </SelectRow>
      </Section>

      <Section title={t("profile.links.header")}>
        <p className="-mt-1 text-footnote text-label-secondary">{t("profile.links.hint")}</p>
        {(Object.keys(LINK_HOSTS) as LinkKey[]).map((key) => (
          <TextField
            key={key}
            id={`profile-link-${key}`}
            type="url"
            inputMode="url"
            autoComplete="url"
            label={t(`profile.links.${key}`)}
            placeholder={key === "linkedin" ? "https://www.linkedin.com/in/…" : key === "github" ? "https://github.com/…" : "https://…"}
            value={draft.links[key] ?? ""}
            maxLength={300}
            error={linkErrors[key] ?? undefined}
            onChange={(e) => setLink(key, e.target.value)}
          />
        ))}
      </Section>

      <Section title={t("profile.prefs.header")}>
        {draft.keywords.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {draft.keywords.map((k) => (
              <Chip
                key={k}
                removeLabel={t("profile.prefs.removeKeyword", { keyword: k })}
                onRemove={() => set("keywords", draft.keywords.filter((x) => x !== k))}
              >
                {k}
              </Chip>
            ))}
          </div>
        ) : null}
        <TextField
          id="profile-keyword"
          label={t("profile.prefs.keywords")}
          hint={t("profile.prefs.keywordsHint")}
          placeholder={t("profile.prefs.keywordsPlaceholder")}
          value={keywordInput}
          maxLength={MAX_KEYWORD_LEN}
          error={keywordError ?? undefined}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            setKeywordError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addKeyword();
            }
          }}
          onBlur={addKeyword}
        />
        <div className="flex min-h-11 items-center gap-3">
          <span className="flex-1 text-body text-label">{t("profile.prefs.remoteOnly")}</span>
          <Toggle label={t("profile.prefs.remoteOnly")} checked={draft.remoteOnly} onChange={(v) => set("remoteOnly", v)} />
        </div>
      </Section>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={!dirty || hasErrors}>
          {t("profile.save")}
        </Button>
      </div>
    </form>
  );
}

function ProfilePageInner() {
  const { t } = useTranslation("account");
  const { data, loading, error, reload } = useApi(() => getProfile(), []);
  return (
    <>
      <NavBar title={t("profile.title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
        <p className="text-body text-label-secondary">{t("profile.intro")}</p>
        {data ? (
          <ProfileForm initial={data.profile} />
        ) : loading ? (
          <div aria-busy="true" className="flex flex-col gap-6">
            <Skeleton className="h-24 w-full rounded-card" />
            <Skeleton className="h-48 w-full rounded-card" />
            <Skeleton className="h-48 w-full rounded-card" />
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-body text-danger-ink">{t("profile.loadError")}</p>
            <Button variant="gray" size="sm" onClick={reload}>
              {t("common:tryAgain")}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** `/profile/`: "Edit profile" — display name, headline, links, location, time zone, job
 * preferences (`GET/PATCH /api/me/profile`). */
export function ProfilePage() {
  return (
    <RequireAuth>
      <ProfilePageInner />
    </RequireAuth>
  );
}
