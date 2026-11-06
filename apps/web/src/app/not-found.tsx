"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { buttonClasses, EmptyState } from "@ujc/ui";

/** 404 for unknown URLs (exported as `404.html`, served by Vercel / Caddy for missing paths). */
export default function NotFound() {
  const { t } = useTranslation("common");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-12">
      <EmptyState
        illustration="search"
        title={t("notFound.title")}
        message={t("notFound.message")}
        action={
          <Link href="/" className={buttonClasses({})}>
            {t("notFound.backToJobs")}
          </Link>
        }
        className="w-full"
      />
    </main>
  );
}
