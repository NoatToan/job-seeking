"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, NavBar, TextField, useToast } from "@ujc/ui";
import { ApiError, deleteMyAccount, exportMyData } from "@/lib/api";
import { RequireAuth } from "@/lib/require-auth";
import { useSession } from "@/lib/session";
import { AccountMenu } from "@/app/nav";

const CONFIRM_TEXT = "DELETE";

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
