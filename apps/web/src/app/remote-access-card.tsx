"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CANDIDATE_COUNTRIES, remoteAccess } from "@ujc/core";
import type { Job } from "@ujc/core";
import {
  AlertTriangleIcon,
  Badge,
  Card,
  CheckCircleIcon,
  countryName,
  flagEmoji,
  FuzzySelect,
  GlobeIcon,
  MapPinIcon,
  remotePlacesLabel,
  useUiStrings,
  XIcon,
} from "@ujc/ui";
import { useBasedIn } from "@/lib/based-in";

/**
 * "Who can apply" on the job detail (Slack: the remote region is critical — make it obvious which
 * countries a remote job accepts so candidates don't waste time applying). States the region in
 * plain words, compares it with where the candidate lives, and lets them change that right here.
 */
export function RemoteAccessCard({ job }: { job: Job }) {
  const { t } = useTranslation("job");
  const strings = useUiStrings();
  const { country: basedIn, guessed, setCountry } = useBasedIn();
  const access = remoteAccess(job.openTo, basedIn);
  const you = basedIn ? `${flagEmoji(basedIn)} ${countryName(basedIn, strings.locale)}` : null;
  const places = remotePlacesLabel(access.places, strings, true, 8);

  const options = useMemo(
    () => [
      { value: "", label: t("remote.notSet") },
      ...CANDIDATE_COUNTRIES.map((c) => ({
        value: c.code,
        label: `${flagEmoji(c.code)} ${countryName(c.code, strings.locale)}`,
      })),
    ],
    [t, strings.locale],
  );

  let badge: { tone: "success" | "danger" | "warning" | "info"; label: string };
  let statement: string;
  if (!job.remote) {
    badge = { tone: "info", label: t("remote.badgeOnsite") };
    statement = job.location ? t("remote.onsite", { location: job.location }) : t("remote.onsiteNoLocation");
  } else if (access.scope === "worldwide") {
    badge = basedIn ? { tone: "success", label: t("remote.badgeOpen") } : { tone: "info", label: t("remote.badgeWorldwide") };
    statement = t("remote.worldwide");
  } else if (access.scope === "restricted") {
    if (access.acceptsCandidate === true) {
      badge = { tone: "success", label: t("remote.badgeOpen") };
      statement = t("remote.restrictedYes", { places, you });
    } else if (access.acceptsCandidate === false) {
      badge = { tone: "danger", label: t("remote.badgeClosed") };
      statement = t("remote.restrictedNo", { places, you });
    } else {
      badge = { tone: "info", label: t("remote.badgeRestricted") };
      statement = t("remote.restricted", { places });
    }
  } else {
    badge = { tone: "warning", label: t("remote.badgeUnknown") };
    statement = t("remote.unknown");
  }

  const Icon =
    badge.tone === "success" ? CheckCircleIcon : badge.tone === "danger" ? XIcon : badge.tone === "warning" ? AlertTriangleIcon : job.remote ? GlobeIcon : MapPinIcon;

  return (
    <Card className="shadow-none" data-testid="remote-access-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-headline text-label">
          <GlobeIcon size={18} aria-hidden /> {t("remote.title")}
        </p>
        <Badge tone={badge.tone} icon={<Icon size={12} strokeWidth={2.5} aria-hidden />}>
          {badge.label}
        </Badge>
      </div>
      <p className="mt-2 text-body text-label">{statement}</p>
      {job.location ? (
        <p className="mt-1 text-footnote text-label-secondary">{t("remote.fromLocation", { location: job.location })}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-subheadline text-label-secondary">
        <span>{t("remote.basedIn")}</span>
        <FuzzySelect
          label={t("remote.basedIn")}
          value={basedIn ?? ""}
          onChange={(v) => void setCountry(v || null)}
          options={options}
          searchPlaceholder={t("remote.searchCountry")}
          className="min-w-[12rem]"
        />
        {guessed ? <span className="text-footnote text-label-tertiary">{t("remote.guessed")}</span> : null}
      </div>
    </Card>
  );
}
