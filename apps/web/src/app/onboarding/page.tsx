import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { OnboardingPage } from "./onboarding-page";

export const metadata: Metadata = { title: "Get started", robots: NO_INDEX };

export default function Page() {
  return <OnboardingPage />;
}
