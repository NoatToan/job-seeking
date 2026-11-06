import type { Metadata, Viewport } from "next";
import { GoogleTagManager } from "@next/third-parties/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ToastProvider } from "@ujc/ui";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/provider";
import { SessionProvider } from "@/lib/session";
import { OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import { AppShell } from "./nav";
import { ViewedSync } from "./viewed-sync";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "remote jobs",
    "relocation jobs",
    "visa sponsorship jobs",
    "tech jobs",
    "software engineer jobs",
    "developer jobs",
    "job board aggregator",
    "Seek",
    "LinkedIn",
    "Himalayas",
    "We Work Remotely",
  ],
  openGraph: OPEN_GRAPH,
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
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
        <NuqsAdapter>
          <I18nProvider>
            <SessionProvider>
              <ViewedSync />
              <ToastProvider>
                <AppShell>{children}</AppShell>
              </ToastProvider>
            </SessionProvider>
          </I18nProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
