import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { ContributePage } from "./contribute-page";

export const metadata: Metadata = { title: "Contribute", robots: NO_INDEX };

export default function Page() {
  return <ContributePage />;
}
