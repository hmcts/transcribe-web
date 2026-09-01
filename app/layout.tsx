import type React from "react";

import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";

import Header from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner";

import { CookieBanner } from "@/components/cookie-banner/cookie-banner";
import { CookieManagerInit } from "@/components/cookie-banner/cookie-manager-init";
import cn from "@/lib/utils";
import AccessGate from "@/providers/access-gate";
import { ThemeProvider } from "@/providers/theme-provider";
import { TranscriptsProvider } from "@/providers/transcripts";
import { UserSettingsProvider } from "@/providers/user-settings";
import PosthogProvider from "../providers/posthog";

const inter = Inter({ subsets: ["latin"] });
const GTM_CONTAINER_ID = "GTM-KB37GM5V";

export const metadata: Metadata = {
  title: "Judicial Transcribe",
  description: "Judicial Transcribe",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const nonce = headersList.get("x-nonce") ?? "";

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
        {/* Google Tag Manager — step 1 */}
        <Script
          id="gtm-init"
          nonce={nonce}
          strategy="afterInteractive"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: GTM bootstrap requires inline script injection
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`,
          }}
        />
        {/* End Google Tag Manager */}
        {/* Google Tag Manager (noscript) — step 2 */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
            title="Google Tag Manager"
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <UserSettingsProvider>
            <PosthogProvider>
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
            </PosthogProvider>
          </UserSettingsProvider>
        </ThemeProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
