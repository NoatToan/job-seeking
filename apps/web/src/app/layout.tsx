import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { SOURCES } from "@ujc/core";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unified Job Crawler",
  description: "Jobs from many sources in one place, matched to your CVs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Unified Job Crawler
            </Link>
            {/* Placeholders: profiles and connections are rebuilt in later milestones (M2-03, M3-01). */}
            <div className="flex items-center gap-4 text-zinc-400">
              <span title="Coming soon">My search profiles</span>
              <span title="Coming soon">Connections</span>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <footer className="border-t border-zinc-200 px-4 py-6 text-xs text-zinc-500 dark:border-zinc-800">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-1">
            <p>
              Jobs crawled from We Work Remotely, Greenhouse, Lever, Ashby, Himalayas, Remotive, and{" "}
              <a
                href={SOURCES.adzuna.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Jobs by Adzuna
              </a>
              .
            </p>
            <p>Every job links to its original posting.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
