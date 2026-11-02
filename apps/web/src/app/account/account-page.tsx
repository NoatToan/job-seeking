"use client";

import { useState } from "react";
import Link from "next/link";
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

const CONFIRM_TEXT = "DELETE";

/** `/account` "Local runner" section (M3-06/M3-07): create a pairing code for
 * `job_crawler.runner pair`, then list/revoke paired runners. `/connections/` is a different
 * page (owned elsewhere); this is the whole UI for the companion runner in flow v2. */
function RunnerSection() {
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
      setCreateError(
        err instanceof ApiError ? err.message : "Could not create a pairing code. Please try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokeRunner(id);
      toast.show({ tone: "success", title: "Runner revoked" });
      reload();
    } catch (err) {
      toast.show({
        tone: "error",
        title: "Could not revoke runner",
        message: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setRevokingId(null);
    }
  }

  const runners = (data?.items ?? []).filter((r) => !r.revokedAt);

  return (
    <section className="flex flex-col gap-3 rounded-card bg-grouped-secondary p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline text-label">Local runner</h2>
        <p className="text-body text-label-secondary">
          Crawl LinkedIn, Glassdoor and Arc.dev from your own machine with your own login. Cookies
          never leave your computer — only the parsed job listings are uploaded.
        </p>
      </div>

      {createError ? (
        <p role="alert" className="text-footnote text-danger-ink">
          {createError}
        </p>
      ) : null}

      {pairing ? (
        <div className="flex flex-col gap-2 rounded-card bg-fill-tertiary p-3">
          <p className="text-footnote text-label-secondary">
            Pairing code (valid 10 minutes, one-time use)
          </p>
          <p className="text-title-2 font-semibold tracking-[0.2em] text-label">{pairing.code}</p>
          <p className="text-footnote text-label-secondary">Run this on your machine:</p>
          <code className="overflow-x-auto rounded-md bg-fill-secondary px-2 py-1.5 text-footnote text-label">
            uv run python -m job_crawler.runner pair --api {"<server-url>"} --code {pairing.code}
          </code>
        </div>
      ) : null}

      <Button onClick={() => void handleCreateCode()} loading={creating} className="self-start">
        {pairing ? "Create a new pairing code" : "Add a local runner"}
      </Button>

      {loading ? (
        <p className="text-footnote text-label-secondary">Loading runners…</p>
      ) : error ? (
        <p role="alert" className="text-footnote text-danger-ink">
          Could not load your runners.
        </p>
      ) : runners.length > 0 ? (
        <GroupedList header="Paired runners">
          {runners.map((runner) => (
            <ListRow
              key={runner.id}
              title={runner.name}
              subtitle={
                runner.lastSeenAt
                  ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}`
                  : "Not connected yet"
              }
              accessory={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRevoke(runner.id)}
                  loading={revokingId === runner.id}
                >
                  Revoke
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
      setExportError(
        err instanceof ApiError ? err.message : "Could not download your data. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      toast.show({ tone: "success", title: "Account deleted", message: "Sorry to see you go." });
      await signOut();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Could not delete your account. Please try again.",
      );
      setDeleting(false);
    }
  }

  return (
    <>
      <NavBar title="Account" trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 sm:px-6">
        <section className="flex flex-col gap-1.5 rounded-card bg-grouped-secondary p-4 shadow-card">
          <h2 className="text-headline text-label">Signed in as</h2>
          <p className="text-body text-label-secondary">{me?.user.email}</p>
        </section>

        <section className="flex flex-col gap-2 rounded-card bg-grouped-secondary p-4 shadow-card">
          <h2 className="text-headline text-label">Your data</h2>
          <p className="text-body text-label-secondary">
            Download a copy of everything we have about you: your account, preferences, CV details
            (not the original file) and applications. See our{" "}
            <Link href="/privacy/" className="font-medium text-tint hover:underline focus-ring">
              privacy notice
            </Link>
            .
          </p>
          {exportError ? (
            <p role="alert" className="text-footnote text-danger-ink">
              {exportError}
            </p>
          ) : null}
          <Button onClick={() => void handleExport()} loading={exporting} className="self-start">
            Download my data
          </Button>
        </section>

        <RunnerSection />

        <section className="flex flex-col gap-2 rounded-card bg-danger-soft p-4 shadow-card">
          <h2 className="text-headline text-danger-ink">Delete account</h2>
          <p className="text-body text-danger-ink">
            This permanently deletes your account, CVs, preferences and applications. This cannot
            be undone.
          </p>
          <TextField
            id="delete-confirm"
            label={`Type ${CONFIRM_TEXT} to confirm`}
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
            Delete my account
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
