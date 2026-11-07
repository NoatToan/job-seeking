import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What JobSeeking stores about you, why, for how long, and how to export or delete it.",
  alternates: { canonical: "/privacy/" },
};

/** Every cookie the site sets. Keep in step with apps/api (auth/session.py, routers/upwork.py,
 * contributor_box/identity.py) and lib/consent-core.ts. */
const COOKIES = [
  { name: "ujc_session", purpose: "Keeps you signed in (HttpOnly)", kind: "Strictly necessary", kept: "Until sign-out, at most 30 days" },
  { name: "ujc_csrf", purpose: "Protects forms against cross-site request forgery", kind: "Strictly necessary", kept: "Same as the session" },
  { name: "cb_visitor", purpose: "Signed pseudonym for guest feedback and spam limits", kind: "Strictly necessary", kept: "400 days" },
  { name: "ujc_upwork_oauth", purpose: "Secures the Upwork connection step", kind: "Strictly necessary", kept: "10 minutes" },
  { name: "ujc_locale", purpose: "The language you picked", kind: "Strictly necessary (preference)", kept: "1 year" },
  { name: "ujc_consent", purpose: "Remembers your cookie choice", kind: "Strictly necessary", kept: "180 days" },
  { name: "_ga, _ga_*", purpose: "Google Analytics 4: counts visits and pages viewed", kind: "Analytics (only with consent)", kept: "Up to 2 years" },
] as const;

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title1 text-label">Privacy notice</h1>
        <p className="text-footnote text-label-secondary">Plain-language summary — last updated November 2026.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-title3 text-label">What we collect</h2>
        <p className="text-body text-label-secondary">
          Your email address, the CV file you upload, the skills/keywords extracted from it, your
          job-search preferences (keywords, remote-only, country) and the applications you track.
          If you send feedback, we also keep what you wrote, the page address and the part of the
          page you pointed at, and the screenshot if you chose to attach one. Only you and our
          admins can see that context.
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

      <section id="cookies" className="flex scroll-mt-20 flex-col gap-2">
        <h2 className="text-title3 text-label">Cookies and local storage</h2>
        <p className="text-body text-label-secondary">
          Strictly necessary cookies are always on, because sign-in and security can&apos;t work
          without them. Analytics cookies are only set if you agree in the cookie banner. Until you
          choose, Google Tag Manager isn&apos;t loaded at all. Rejecting is as easy as accepting, and
          you can change or withdraw your choice at any time. Withdrawing deletes the analytics
          cookies from your browser.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-footnote text-label-secondary">
            <thead className="text-label">
              <tr>
                <th className="py-1 pr-3 font-semibold">Name</th>
                <th className="py-1 pr-3 font-semibold">Purpose</th>
                <th className="py-1 pr-3 font-semibold">Kind</th>
                <th className="py-1 font-semibold">Kept for</th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((c) => (
                <tr key={c.name} className="hairline-t align-top">
                  <td className="py-1.5 pr-3 font-mono text-label">{c.name}</td>
                  <td className="py-1.5 pr-3">{c.purpose}</td>
                  <td className="py-1.5 pr-3">{c.kind}</td>
                  <td className="py-1.5">{c.kept}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-body text-label-secondary">
          Your browser&apos;s local storage also keeps preferences you set on this device (theme,
          timezone, jobs you&apos;ve already viewed). They never leave your device unless you sign in.{" "}
          <CookieSettingsButton className="cursor-pointer font-medium text-tint hover:underline focus-ring" />
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
