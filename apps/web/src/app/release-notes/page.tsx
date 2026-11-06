import type { Metadata } from "next";
import { OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { ReleaseNotesPage } from "./release-notes-page";

const TITLE = "Release notes";
const DESCRIPTION =
  "Everything new on JobSeeking, day by day: new filters, pages and fixes, written from every update to the site. Follow along with the RSS feed.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/release-notes/",
    types: { "application/atom+xml": [{ url: "/release-notes/feed.xml", title: `${SITE_NAME} release notes` }] },
  },
  openGraph: { ...OPEN_GRAPH, url: "/release-notes/", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

export default function Page() {
  // The activity numbers are counted from the build day first, then from the visitor's today.
  return <ReleaseNotesPage builtAt={new Date().toISOString()} />;
}
