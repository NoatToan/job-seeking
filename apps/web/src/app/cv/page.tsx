import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { CvPage } from "./cv-page";

export const metadata: Metadata = { title: "My CV", robots: NO_INDEX };

export default function Page() {
  return <CvPage />;
}
