"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Button, buttonClasses, EmptyState } from "@ujc/ui";

/**
 * Root error boundary (app-router rule: every segment ships an error state). Catches render errors
 * in any page under the root layout, so the nav stays and the user gets a way out instead of a
 * blank screen. `retry` re-renders the segment.
 */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation("common");

  useEffect(() => {
    // Surfaces in the browser console and in Sentry's console breadcrumb when it is enabled.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-12">
      <EmptyState
        tone="error"
        illustration="error"
        title={t("error.title")}
        message={t("error.message")}
        action={<Button onClick={retry}>{t("tryAgain")}</Button>}
        secondaryAction={
          <Link href="/" className={buttonClasses({ variant: "gray" })}>
            {t("error.backToJobs")}
          </Link>
        }
        className="w-full"
      />
    </main>
  );
}
