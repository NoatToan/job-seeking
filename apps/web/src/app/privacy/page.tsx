import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What JobSeeking stores about you, why, for how long, and how to export or delete it.",
  alternates: { canonical: "/privacy/" },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title1 text-label">Privacy notice</h1>
        <p className="text-footnote text-label-secondary">Plain-language summary — last updated 2026.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">What we collect</h2>
        <p className="text-body text-label-secondary">
          Your email address, the CV file you upload, the skills/keywords extracted from it, your
          job-search preferences (keywords, remote-only, country) and the applications you track.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">Why we collect it</h2>
        <p className="text-body text-label-secondary">
          To sign you in (email one-time codes), to match you to relevant jobs, and to let you keep
          track of the jobs you apply to.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">AI processing of your CV</h2>
        <p className="text-body text-label-secondary">
          When you upload a CV, its text is sent to Claude (an AI model by Anthropic, running on a
          host machine we operate) to extract your skills, seniority and a short summary. This only
          happens after you agree on the CV page. You can withdraw by deleting your CV or your
          account at any time.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">How long we keep it</h2>
        <p className="text-body text-label-secondary">
          Your CV file and its extracted text are kept for up to 180 days after upload, after which
          the original file and raw text are deleted automatically (your extracted skills/keywords
          are kept so matching keeps working). You can delete a CV, or your whole account, at any
          time from the{" "}
          <Link href="/account/" className="font-medium text-tint hover:underline focus-ring">
            Account
          </Link>{" "}
          page.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">Your rights</h2>
        <p className="text-body text-label-secondary">
          You can download a copy of your data (JSON export) or delete your account at any time from
          the Account page. Depending on where you live, you may have additional rights — for
          example under Vietnam&apos;s Personal Data Protection Law (Decree 13/2023/ND-CP and
          successors) or the Australian Privacy Act 1988 (Cth) and its Australian Privacy
          Principles — including the right to access, correct or erase your data, and to withdraw
          consent.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">Contact</h2>
        <p className="text-body text-label-secondary">
          Questions or requests about your data: <em>privacy@example.com</em> (placeholder — update
          before a public launch).
        </p>
      </section>
    </div>
  );
}
