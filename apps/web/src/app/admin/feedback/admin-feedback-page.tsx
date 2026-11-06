"use client";

import { useTranslation } from "react-i18next";
import { AdminReview } from "@contributor-box/react";
import { NavBar } from "@ujc/ui";
import { AccountMenu } from "@/app/nav";
import { RequireAuth } from "@/lib/require-auth";

/** `/admin/feedback/`: review queue for admins. `AdminReview` asks `GET /api/feedback/meta`
 * whether the viewer is an admin (and shows "for admins" otherwise); every action it takes is
 * re-authorised by the API, so a non-admin reaching this page can read or change nothing. */
export function AdminFeedbackPage() {
  const { t } = useTranslation("contributor");
  return (
    <RequireAuth>
      <NavBar title={t("page.adminTitle")} trailing={<div className="md:hidden"><AccountMenu /></div>} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-24 sm:px-6">
        <p className="text-callout text-label-secondary">{t("page.adminSubtitle")}</p>
        <AdminReview />
      </div>
    </RequireAuth>
  );
}
