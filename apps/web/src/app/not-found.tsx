"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { buttonClasses, EmptyState } from "@ujc/ui";
import { jobIdFromPath } from "@/lib/job-url";

/**
 * 404 for unknown URLs (exported as `404.html`, served with a 404 status by Vercel — see the
 * `handle: error` route in vercel.json — and by Caddy for missing paths).
 *
 * A job page URL (`/jobs/<words>-<id>/`) that isn't in this build — a job found after the last
 * build, or a renamed one — still answers 404 to crawlers, but a person is sent on to the live
 * `/jobs/view/?id=<id>` page, which loads the job from the API (and says so if it is gone).
 */
export default function NotFound() {
  const { t } = useTranslation("common");
  useEffect(() => {
    const id = jobIdFromPath(window.location.pathname);
    if (id) window.location.replace(`/jobs/view/?id=${encodeURIComponent(id)}`);
  }, []);
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
