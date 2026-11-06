import type { Metadata } from "next";
import { Suspense } from "react";
import { OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { Home } from "./home";

// Canonical only here and on /privacy/: job pages (`/jobs/view/?id=…`) set their own in the
// browser, and must not inherit "/" from the layout.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...OPEN_GRAPH, url: "/" },
};

/**
 * schema.org `WebSite` + `SearchAction` (Google sitelinks search box): `/?q=…` opens the home list
 * already filtered, because the filters live in the URL.
 */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/icon.svg`,
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, build-time JSON; `<` escaped so the payload can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      {/* `Home` reads the filters from the URL (nuqs), so it renders in the browser. */}
      <Suspense fallback={<p className="px-4 py-8 text-body text-label-secondary">Loading…</p>}>
        <Home />
      </Suspense>
    </>
  );
}
