import type React from "react";

import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { CookieBanner } from "@/components/cookie-banner/cookie-banner";
import { CookieManagerInit } from "@/components/cookie-banner/cookie-manager-init";
import Header from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner";
import cn from "@/lib/utils";
import AccessGate from "@/providers/access-gate";
import PageViewTracker from "@/providers/page-view-tracker";
import { ThemeProvider } from "@/providers/theme-provider";
import { TranscriptsProvider } from "@/providers/transcripts";
import { UserSettingsProvider } from "@/providers/user-settings";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Bench Notes",
  description: "Bench Notes",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce from proxy.ts (Next.js adds it to its own scripts). Passed
  // to next-themes for its inline theme script, as its docs describe. Production
  // HTML still shows that script without a nonce: to be checked in a deployed
  // environment (the theme is then applied after hydration rather than before paint).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="scroll-smooth scroll-pt-20"
    >
      <head>
        <script src="/env-config.js" />
      </head>
      <body className={inter.className}>
        <CookieManagerInit />
        <ThemeProvider
          nonce={nonce}
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <UserSettingsProvider>
            <PageViewTracker />
            <TranscriptsProvider>
              <AccessGate>
                <div className="flex min-h-screen min-w-0 flex-col">
                  <Header />
                  <div className={cn("mx-auto flex w-full min-w-0 flex-1")}>
                    <main className="mt-14 w-full min-w-0">{children}</main>
                  </div>
                </div>
                <Toaster />
              </AccessGate>
            </TranscriptsProvider>
          </UserSettingsProvider>
        </ThemeProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
