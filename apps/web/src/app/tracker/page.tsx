import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { Tracker } from "./tracker";

export const metadata: Metadata = { title: "Tracker", robots: NO_INDEX };

export default function Page() {
  return <Tracker />;
}
