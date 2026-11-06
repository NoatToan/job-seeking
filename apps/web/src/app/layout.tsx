import type { Metadata } from "next";
import { GoogleTagManager } from "@next/third-parties/google";
import { ToastProvider } from "@ujc/ui";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { AppShell } from "./nav";
import { ViewedSync } from "./viewed-sync";

export const metadata: Metadata = {
  title: "JobSeeking",
  description: "Tech jobs from every board in one place, matched to your CV.",
};

// Google Tag Manager container (GA4 is configured inside it). Build with NEXT_PUBLIC_GTM_ID="" to
// turn it off, e.g. for local dev.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? "GTM-WSR78ZW4";

// System font stack only (DESIGN_SYSTEM.md §4: no web font download; `--font-sans` in
// theme.css already covers SF Pro / Inter / Segoe UI / Roboto with full Vietnamese coverage).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      {GTM_ID ? <GoogleTagManager gtmId={GTM_ID} /> : null}
      <body className="min-h-full bg-grouped text-label">
        <SessionProvider>
          <ViewedSync />
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
