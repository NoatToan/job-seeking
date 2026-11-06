import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { AdminFeedbackPage } from "./admin-feedback-page";

export const metadata: Metadata = { title: "Review feedback", robots: NO_INDEX };

export default function Page() {
  return <AdminFeedbackPage />;
}
