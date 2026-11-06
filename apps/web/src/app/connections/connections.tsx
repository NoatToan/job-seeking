"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useQueryState } from "nuqs";
import type { Platform } from "@ujc/core";
import { DEEP_LINK_SITES } from "@ujc/core";
import {
  Badge,
  Button,
  buttonClasses,
  Card,
  EmptyState,
  ExternalLinkIcon,
  GroupedList,
  JobCardSkeleton,
  ListRow,
  NavBar,
  RefreshIcon,
  TextField,
  useToast,
} from "@ujc/ui";
import {
  ApiError,
  connectAdzuna,
  disconnectPlatform,
  getPlatforms,
  upworkAuthorizeUrl,
} from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useApi } from "@/lib/use-api";
import { AccountMenu } from "@/app/nav";

const UPWORK_MCP_URL = "https://mcp.upwork.com/mcp";
const UPWORK_SEARCH_URL = DEEP_LINK_SITES.find((s) => s.label === "Upwork")?.search("") ?? "https://www.upwork.com/nx/search/jobs/";

function statusDetail(platform: Platform, t: TFunction<"connections">): string {
  if (platform.status === "error") return t("builtIn.statusError");
  if (platform.status === "running") return t("builtIn.statusRunning");
  return t("builtIn.statusAlwaysOn");
}

function BuiltInSourcesCard({ platforms }: { platforms: Platform[] }) {
  const { t } = useTranslation("connections");
  if (platforms.length === 0) return null;
  return (
    <GroupedList header={t("builtIn.header")} label={t("builtIn.ariaLabel")} footer={t("builtIn.footer")}>
      {platforms.map((p) => (
        <ListRow key={p.id} title={p.label} detail={statusDetail(p, t)} />
      ))}
    </GroupedList>
  );
}

interface AdzunaCardProps {
  platform: Platform;
  onChanged: () => void;
}

function AdzunaCard({ platform, onChanged }: AdzunaCardProps) {
  const { t } = useTranslation("connections");
  const toast = useToast();
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      await connectAdzuna(appId.trim(), appKey.trim());
      setAppId("");
      setAppKey("");
      toast.show({ tone: "success", title: t("adzuna.connectedToast") });
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === "invalid_credentials"
            ? t("adzuna.errors.invalidCredentials")
            : err.message
          : t("adzuna.errors.connectFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectPlatform("adzuna");
      toast.show({ tone: "success", title: t("adzuna.disconnectedToast") });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("adzuna.errors.disconnectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-headline text-label">{t("adzuna.heading")}</h2>
        {platform.connected ? <Badge tone="success">{t("badges.connected")}</Badge> : null}
      </div>
      <p className="text-body text-label-secondary">
        <Trans
          i18nKey="connections:adzuna.description"
          components={{
            link: (
              <a
                href={platform.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-tint hover:underline focus-ring"
              />
            ),
          }}
        />
      </p>
      {error ? (
        <p role="alert" className="text-footnote text-danger-ink">
          {error}
        </p>
      ) : null}
      {platform.connected ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-body text-label-secondary">
            {platform.externalAccount
              ? t("adzuna.appIdLabel", { appId: platform.externalAccount })
              : t("adzuna.connectedLabel")}
          </p>
          <Button variant="destructive" size="sm" loading={busy} onClick={() => void handleDisconnect()}>
            {t("actions.disconnect")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField
            label={t("adzuna.appIdFieldLabel")}
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            className="flex-1"
          />
          <TextField
            label={t("adzuna.appKeyFieldLabel")}
            type="password"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            className="flex-1"
          />
          <Button
            loading={busy}
            disabled={!appId.trim() || !appKey.trim()}
            onClick={() => void handleConnect()}
          >
            {t("adzuna.connectButton")}
          </Button>
        </div>
      )}
    </Card>
  );
}

interface UpworkCardProps {
  platform: Platform;
  onChanged: () => void;
}

function UpworkCard({ platform, onChanged }: UpworkCardProps) {
  const { t } = useTranslation("connections");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectPlatform("upwork");
      toast.show({ tone: "success", title: t("toast.upworkConnected") });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("upwork.errors.disconnectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-headline text-label">{t("upwork.heading")}</h2>
        {platform.available && platform.connected ? <Badge tone="success">{t("badges.connected")}</Badge> : null}
      </div>

      <div className="flex flex-col gap-1.5 rounded-control border border-control-border p-3">
        <p className="text-subheadline font-semibold text-label">{t("upwork.mcpTitle")}</p>
        <p className="text-footnote text-label-secondary">{t("upwork.mcpDescription")}</p>
        <code className="rounded-control-sm bg-fill-tertiary px-2 py-1 text-footnote text-label">
          {UPWORK_MCP_URL}
        </code>
      </div>

      <a
        href={UPWORK_SEARCH_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses({ variant: "gray", size: "sm" }) + " self-start"}
      >
        <ExternalLinkIcon size={16} />
        {t("upwork.searchLink")}
      </a>

      {error ? (
        <p role="alert" className="text-footnote text-danger-ink">
          {error}
        </p>
      ) : null}

      {!platform.available ? (
        <p className="text-footnote text-label-tertiary">{t("upwork.notAvailable")}</p>
      ) : platform.connected ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-body text-label-secondary">{t("upwork.connectedForSearch")}</p>
          <Button variant="destructive" size="sm" loading={busy} onClick={() => void handleDisconnect()}>
            {t("actions.disconnect")}
          </Button>
        </div>
      ) : (
        <a href={upworkAuthorizeUrl()} className={buttonClasses({ size: "sm" }) + " self-start"}>
          {t("upwork.connectForSearch")}
        </a>
      )}
    </Card>
  );
}

function RunnerCard({ platforms }: { platforms: Platform[] }) {
  const { t } = useTranslation("connections");
  if (platforms.length === 0) return null;
  const connected = platforms.some((p) => p.connected);
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-headline text-label">{t("runner.heading")}</h2>
        {connected ? <Badge tone="success">{t("runner.pairedBadge")}</Badge> : null}
      </div>
      <p className="text-body text-label-secondary">
        {t("runner.description", { platforms: platforms.map((p) => p.label).join(" and ") })}
      </p>
      <Link
        href="/account/#runner"
        className={buttonClasses({ variant: "gray", size: "sm" }) + " self-start"}
      >
        {connected ? t("runner.manage") : t("runner.setUp")}
      </Link>
    </Card>
  );
}

const UPWORK_TOAST: Record<string, { tone: "success" | "error" | "info"; title: string }> = {
  connected: { tone: "success", title: "Upwork connected" },
  denied: { tone: "info", title: "Upwork connection cancelled" },
  error: { tone: "error", title: "Could not connect Upwork. Please try again." },
};

function ConnectionsInner() {
  const { data, loading, error, reload } = useApi(() => getPlatforms(), []);
  // `?upwork=connected|denied|…` is set by the Upwork OAuth callback: toast once, then drop it.
  const [upworkResult, setUpworkResult] = useQueryState("upwork");
  const toast = useToast();
  const handledUpworkParam = useRef(false);

  useEffect(() => {
    if (!upworkResult || handledUpworkParam.current) return;
    handledUpworkParam.current = true;
    const entry = UPWORK_TOAST[upworkResult];
    if (entry) toast.show(entry);
    void setUpworkResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upworkResult]);

  const items = data?.items ?? [];
  const publicPlatforms = items.filter((p) => p.kind === "public");
  const adzuna = items.find((p) => p.id === "adzuna");
  const upwork = items.find((p) => p.id === "upwork");
  const runnerPlatforms = items.filter((p) => p.kind === "runner");

  return (
    <>
      <NavBar title="Connections" trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-16 sm:px-6">
        {loading ? (
          <div aria-busy="true" aria-label="Loading your connections" className="flex flex-col gap-3">
            <JobCardSkeleton />
            <JobCardSkeleton />
          </div>
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title="We couldn't load your connections"
            message="It's on our side, not yours. Check your connection and try again."
            action={
              <button type="button" onClick={reload} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                Try again
              </button>
            }
          />
        ) : (
          <>
            <BuiltInSourcesCard platforms={publicPlatforms} />
            {adzuna ? <AdzunaCard platform={adzuna} onChanged={reload} /> : null}
            {upwork ? <UpworkCard platform={upwork} onChanged={reload} /> : null}
            <RunnerCard platforms={runnerPlatforms} />
          </>
        )}
      </div>
    </>
  );
}

export function Connections() {
  return (
    <RequireAuth>
      <ConnectionsInner />
    </RequireAuth>
  );
}
