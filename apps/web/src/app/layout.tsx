import type { Metadata } from "next";
import { ToastProvider } from "@ujc/ui";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { AppShell } from "./nav";

export const metadata: Metadata = {
  title: "Unified Job Crawler",
  description: "Jobs from many sources in one place, matched to your CVs.",
};

// System font stack only (DESIGN_SYSTEM.md §4: no web font download; `--font-sans` in
// theme.css already covers SF Pro / Inter / Segoe UI / Roboto with full Vietnamese coverage).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-grouped text-label">
        <SessionProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
