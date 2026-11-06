"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Trans, useTranslation } from "react-i18next";
import type { Job, PublicJobsPage } from "@ujc/core";
import { buttonClasses, EmptyState, RefreshIcon, SparklesIcon, Spinner } from "@ujc/ui";
import { getPublicJobs, getSources } from "@/lib/api";
import { LoadMoreSentinel } from "@/lib/load-more-sentinel";
import { useApi } from "@/lib/use-api";
import { useInfiniteList } from "@/lib/use-infinite";
import { useScrollRestoration } from "@/lib/view-cache";
import { HomeHero, SourcesSummary } from "@/app/home-hero";
import { SaveJobButton } from "@/app/save-job-button";
import { useSession } from "@/lib/session";
import { useLoginGate } from "@/lib/login-modal";
import { greeting, greetingName } from "@/app/feed";
import { JobBrowser } from "@/app/job-browser";
import { JobBrowserSkeleton, SourcesPillSkeleton } from "@/app/skeletons";
import { JobFilterBar, JobFilterSummary, useJobFilters, useVisibleJobs } from "@/app/job-filters";
import { highlightTerms } from "@/lib/highlight";
import { WhatsNewChip } from "@/app/release-notes/whats-new-chip";

/**
 * `/` for a signed-out visitor: the public job catalogue (Slack request — "without logging in,
 * the home page should still show all the jobs we have"). Unlike `Feed`, this calls only public
 * endpoints (`GET /api/jobs`, `GET /api/sources`), so it never trips the global 401 handler and
 * never redirects to `/login` (see `lib/session.tsx` `isPublicRoute`).
 */
export function PublicJobs({
  signedIn = false,
  modeSwitch,
}: {
  /** Signed in, "All jobs" mode: same catalogue, plus Track on each row and in the detail. */
  signedIn?: boolean;
  /** "All jobs | For you" switch (signed in only), shown in the hero. */
  modeSwitch?: ReactNode;
} = {}) {
  const { me } = useSession();
  const { openLogin } = useLoginGate();
  const { t } = useTranslation("home");
  const filters = useJobFilters("public");
  const { data: sources, error: sourcesError } = useApi(getSources, [], { cacheKey: "sources" });

  const { params: filterParams } = filters;
  const fetchPage = useCallback(
    (cursor: string | undefined) => getPublicJobs({ cursor, ...filterParams }),
    // `filters.key` captures every value in `filterParams`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.key],
  );

  const listKey = `public:${filters.key}`;
  const { items, nextCursor, loading, error, initialized, loadMore, retry, restored } = useInfiniteList<
    Job,
    PublicJobsPage
  >(fetchPage, [filters.key], { cacheKey: listKey });
  useScrollRestoration(listKey, restored);
  const visible = useVisibleJobs(filters, items);

  return (
    <>
      <HomeHero
        collapsedSummary={<JobFilterSummary filters={filters} />}
        title={
          me && signedIn ? (
            `${greeting()}, ${greetingName(me.user)}`
          ) : (
            <Trans
              t={t}
              i18nKey="hero.titleLove"
              components={{ love: <span className="bg-[image:var(--ujc-brand-text-gradient)] bg-clip-text text-transparent" /> }}
            />
          )
        }
        compactOnPhones
        subtitle={
          me && signedIn ? (
            <p>
              {t("hero.subtitleFreeSearch")}{" "}
              {me.latestCv ? null : (
                <Trans
                  t={t}
                  i18nKey="hero.uploadCv"
                  components={{
                    cvLink: <Link href="/cv/" className="rounded-control-sm font-medium text-tint hover:underline focus-ring" />,
                    strong: <span className="font-medium" />,
                  }}
                />
              )}
            </p>
          ) : (
            t("hero.subtitlePublic")
          )
        }
        aside={
          <>
            {modeSwitch}
            {/* Hold the pill's place while sources load, so the hero doesn't grow under the reader. */}
            {sources || sourcesError ? <SourcesSummary sources={sources ?? []} /> : <SourcesPillSkeleton />}
            <WhatsNewChip />
            <span className={signedIn ? "hidden" : "hidden lg:inline-flex"}>
              <button type="button" onClick={() => openLogin()} className={buttonClasses({ size: "sm", className: "rounded-full px-4" })}>
                <SparklesIcon size={16} />
                {t("hero.signInCta")}
              </button>
            </span>
          </>
        }
      >
        <JobFilterBar filters={filters} sources={(sources ?? []).map((s) => s.source)} />
      </HomeHero>

      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-4 sm:px-6">
        {loading && items.length === 0 ? (
          <JobBrowserSkeleton label={t("list.loadingJobs")} actions={signedIn} />
        ) : error ? (
          <EmptyState
            tone="error"
            illustration="error"
            title={t("list.errorTitle")}
            message={t("list.errorMessage")}
            action={
              <button type="button" onClick={retry} className={buttonClasses({ variant: "gray", size: "sm" })}>
                <RefreshIcon size={16} />
                {t("common:tryAgain")}
              </button>
            }
          />
        ) : initialized && items.length === 0 ? (
          <EmptyState
            illustration="search"
            title={t("list.emptyTitle")}
            message={t("list.emptyMessage")}
            action={
              filters.activeCount ? (
                <button
                  type="button"
                  onClick={filters.clear}
                  className={buttonClasses({ variant: "gray", size: "sm" })}
                >
                  {t("list.clearFilters")}
                </button>
              ) : undefined
            }
          />
        ) : (
          <JobBrowser
            jobs={visible}
            stateKey="public"
            highlight={highlightTerms({ q: filters.q, tech: filters.tech })}
            signedIn={signedIn}
            renderActions={signedIn ? (job) => <SaveJobButton jobId={job.id} compact /> : undefined}
            onNearEnd={nextCursor && !loading ? loadMore : undefined}
            footer={
              <>
                {nextCursor ? <LoadMoreSentinel active={!loading} onVisible={loadMore} /> : null}
                {loading && items.length > 0 ? (
                  <p className="flex items-center justify-center gap-2 py-2 text-footnote text-label-secondary">
                    <Spinner size={14} /> Loading more…
                  </p>
                ) : null}
                {initialized && !nextCursor && items.length > 0 ? (
                  <p role="status" className="py-4 text-center text-footnote text-label-secondary">
                    {t("list.endPublic")}
                  </p>
                ) : null}
              </>
            }
          />
        )}
      </div>
    </>
  );
}
