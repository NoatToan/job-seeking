import type { Metadata } from "next";
import { NO_INDEX } from "@/lib/site";
import { ProfilePage } from "./profile-page";

export const metadata: Metadata = { title: "Edit profile", robots: NO_INDEX };

export default function Page() {
  return <ProfilePage />;
}
