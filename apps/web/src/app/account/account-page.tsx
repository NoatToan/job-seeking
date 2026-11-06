"use client";

import { useState } from "react";
import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { Button, GroupedList, ListRow, NavBar, TextField, useToast } from "@ujc/ui";
import {
  ApiError,
  createRunnerPairingCode,
  deleteMyAccount,
  exportMyData,
  listRunners,
  revokeRunner,
} from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useApi } from "@/lib/use-api";
import { useSession } from "@/lib/session";
import { AccountMenu } from "@/app/nav";
import { PersonalAccessTokens } from "./personal-access-tokens";

const CONFIRM_TEXT = "DELETE";

/** `/account` "Local runner" section (M3-06/M3-07): create a pairing code for
 * `job_crawler.runner pair`, then list/revoke paired runners. `/connections/` is a different
 * page (owned elsewhere); this is the whole UI for the companion runner in flow v2. */
function RunnerSection() {
  const { t } = useTranslation("account");
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => listRunners(), []);

  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleCreateCode() {
    setCreating(true);
    setCreateError(null);
    try {
      setPairing(await createRunnerPairingCode());
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t("runner.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeRunner(id);
      toast.show({ tone: "success", title: t("runner.revokedToast") });
      reload();
    } catch (err) {
      toast.show({
        tone: "error",
        title: t("runner.revokeFailedTitle"),
        message: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setRevokingId(null);
    }
  }

  const runners = (data?.items ?? []).filter((r) => !r.revokedAt);

  return (
    <section
      id="runner"
      className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-headline text-label">{t("runner.title")}</h2>
        <p className="text-body text-label-secondary">{t("runner.description")}</p>
      </div>

      {createError ? (
        <p role="alert" className="text-footnote text-danger-ink">
          {createError}
        </p>
      ) : null}

      {pairing ? (
        <div className="flex flex-col gap-2 rounded-card bg-fill-tertiary p-3">
          <p className="text-footnote text-label-secondary">{t("runner.pairingCodeLabel")}</p>
          <p className="text-title-2 font-semibold tracking-[0.2em] text-label">{pairing.code}</p>
          <p className="text-footnote text-label-secondary">{t("runner.runOnMachine")}</p>
          <code className="overflow-x-auto rounded-md bg-fill-secondary px-2 py-1.5 text-footnote text-label">
            uv run python -m job_crawler.runner pair --api {"<server-url>"} --code {pairing.code}
          </code>
        </div>
      ) : null}

      <Button onClick={() => void handleCreateCode()} loading={creating} className="self-start">
        {pairing ? t("runner.createNewCode") : t("runner.addLocalRunner")}
      </Button>

      {loading ? (
        <p className="text-footnote text-label-secondary">{t("runner.loadingRunners")}</p>
      ) : error ? (
        <p role="alert" className="text-footnote text-danger-ink">
          {t("runner.loadError")}
        </p>
      ) : runners.length > 0 ? (
        <GroupedList header={t("runner.pairedRunnersHeader")}>
          {runners.map((runner) => (
            <ListRow
              key={runner.id}
              title={runner.name}
              subtitle={
                runner.lastSeenAt
                  ? t("runner.lastSeen", { date: new Date(runner.lastSeenAt).toLocaleString() })
                  : t("runner.notConnectedYet")
              }
              accessory={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRevoke(runner.id)}
                  loading={revokingId === runner.id}
                >
                  {t("actions.revoke")}
                </Button>
              }
            />
          ))}
        </GroupedList>
      ) : null}
    </section>
  );
}

function AccountPageInner() {
  const { t } = useTranslation("account");
  const { me, signOut } = useSession();
  const toast = useToast();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportMyData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : t("yourData.exportError"));
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      toast.show({
        tone: "success",
        title: t("deleteAccount.deletedToastTitle"),
        message: t("deleteAccount.deletedToastMessage"),
      });
      await signOut();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t("deleteAccount.deleteError"));
      setDeleting(false);
    }
  }

  return (
    <>
      <NavBar title={t("nav.title")} trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
        <section className="flex flex-col gap-1.5 rounded-card bg-grouped-secondary p-4 shadow-card">
          <h2 className="text-headline text-label">{t("signedInAs")}</h2>
          <p className="text-body text-label-secondary">{me?.user.email}</p>
        </section>

        <section className="flex flex-col gap-2 rounded-card bg-grouped-secondary p-4 shadow-card">
          <h2 className="text-headline text-label">{t("yourData.title")}</h2>
          <p className="text-body text-label-secondary">
            <Trans
              i18nKey="account:yourData.description"
              components={{
                link: <Link href="/privacy/" className="font-medium text-tint hover:underline focus-ring" />,
              }}
            />
          </p>
          {exportError ? (
            <p role="alert" className="text-footnote text-danger-ink">
              {exportError}
            </p>
          ) : null}
          <Button onClick={() => void handleExport()} loading={exporting} className="self-start">
            {t("yourData.downloadButton")}
          </Button>
        </section>

        <RunnerSection />

        <PersonalAccessTokens />

        <section className="flex flex-col gap-2 rounded-card bg-danger-soft p-4 shadow-card">
          <h2 className="text-headline text-danger-ink">{t("deleteAccount.title")}</h2>
          <p className="text-body text-danger-ink">{t("deleteAccount.warning")}</p>
          <TextField
            id="delete-confirm"
            label={t("deleteAccount.confirmLabel", { confirmText: CONFIRM_TEXT })}
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
          />
          {deleteError ? (
            <p role="alert" className="text-footnote text-danger-ink">
              {deleteError}
            </p>
          ) : null}
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            loading={deleting}
            disabled={confirmInput !== CONFIRM_TEXT}
            className="self-start"
          >
            {t("deleteAccount.deleteButton")}
          </Button>
        </section>
      </div>
    </>
  );
}

export function AccountPage() {
  return (
    <RequireAuth>
      <AccountPageInner />
    </RequireAuth>
  );
}
