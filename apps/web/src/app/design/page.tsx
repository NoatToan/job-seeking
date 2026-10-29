import type { Metadata } from "next";
import { Styleguide } from "./styleguide";

export const metadata: Metadata = {
  title: "Design system · Unified Job Crawler",
  description: "Living styleguide for the Sunrise Cupertino design system (packages/ui).",
};

// Static page (works with `output: 'export'`); everything interactive lives in the client component.
export default function DesignPage() {
  return <Styleguide />;
}
