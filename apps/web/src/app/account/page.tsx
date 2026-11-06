import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { AccountPage } from "./account-page";

export const metadata: Metadata = { title: "Account", robots: NO_INDEX };

export default function Page() {
  return <AccountPage />;
}
