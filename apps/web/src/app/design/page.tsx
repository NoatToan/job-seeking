import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { Styleguide } from "./styleguide";

export const metadata: Metadata = {
  title: "Design system",
  description: "Living styleguide for the Sunrise Cupertino design system (packages/ui).",
  robots: NO_INDEX,
};

// Static page (works with `output: 'export'`); everything interactive lives in the client component.
export default function DesignPage() {
  return <Styleguide />;
}
