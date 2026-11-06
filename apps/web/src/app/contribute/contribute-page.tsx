"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ContributorBoard } from "@contributor-box/react";
import { buttonClasses, NavBar } from "@ujc/ui";
import { AccountMenu } from "@/app/nav";
import { useIsAdmin } from "@/lib/contributor";
import { RequireAuth } from "@/lib/require-auth";

/** `/contribute/`: the Contributor screen. Ideas board with votes, the user's own feedback and
 * its status, and a "Suggest an idea" form. In-page feedback comes from the floating widget. */
export function ContributePage() {
  const { t } = useTranslation("contributor");
  const isAdmin = useIsAdmin();
  return (
    <RequireAuth>
      <NavBar
        title={t("page.title")}
        trailing={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Link href="/admin/feedback/" className={buttonClasses({ variant: "tinted", size: "sm" })}>
                {t("nav.reviewFeedback")}
              </Link>
            ) : null}
            <div className="md:hidden">
              <AccountMenu />
            </div>
          </div>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-24 sm:px-6">
        <p className="text-callout text-label-secondary">{t("page.subtitle")}</p>
        <ContributorBoard />
      </div>
    </RequireAuth>
  );
}
