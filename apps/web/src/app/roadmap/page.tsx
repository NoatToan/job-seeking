import type { Metadata } from "next";
import { OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { RoadmapPage } from "./roadmap-page";

const TITLE = "Roadmap";
const DESCRIPTION =
  "Feature ideas and requests from the JobSeeking community and where each one stands: under consideration, planned or done. Vote for what you want next or suggest an idea.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/roadmap/" },
  openGraph: { ...OPEN_GRAPH, url: "/roadmap/", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

export default function Page() {
  return <RoadmapPage />;
}
