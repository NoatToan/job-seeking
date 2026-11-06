"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Roadmap } from "@contributor-box/react";
import { buttonClasses, NavBar } from "@ujc/ui";
import { AccountMenu } from "@/app/nav";
import { useSession } from "@/lib/session";

/** `/roadmap/`: public kanban of every community bug, feedback and idea by status (new, under
 * review, under consideration, planned, done; `rejected` stays hidden). Readable and commentable
 * signed out (contributor-box `public_board` + `allow_anonymous_comments`); voting needs a session.
 * Five columns need the full width, so the NavBar and the content are both `wide` (still the same
 * title column, so heading, intro and board line up). "Suggest an idea" opens the floating
 * feedback widget, which accepts guests (D14). */
export function RoadmapPage() {
  const { t } = useTranslation("contributor");
  const { me } = useSession();
  return (
    <>
      <NavBar
        wide
        title={t("roadmap.title")}
        trailing={
          <div className="flex items-center gap-2">
            {me ? (
              <Link href="/contribute/" className={buttonClasses({ variant: "tinted", size: "sm" })}>
                {t("nav.contribute")}
              </Link>
            ) : null}
            <div className="md:hidden">
              <AccountMenu />
            </div>
          </div>
        }
      />
      <div className="mx-auto flex w-full max-w-none flex-col gap-4 px-4 pb-24">
        <p className="max-w-2xl text-callout text-label-secondary">{t("roadmap.subtitle")}</p>
        <Roadmap />
      </div>
    </>
  );
}
