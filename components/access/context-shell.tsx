"use client";

import Link from "next/link";
import type React from "react";
import { DevPersonaPicker } from "@/components/access/dev-persona-picker";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The page around the screens a user sees before they are in a working context
 * (loading, choose, no access yet, sign-in): the full header needs a context.
 * Keeps what a person stuck here may need: the way home, a theme, in local
 * development the persona picker, and signing out.
 */
export function ContextShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen min-w-0 flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="text-xl font-medium text-foreground">
            Bench Notes
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account">
            <DevPersonaPicker className="flex h-10 items-center gap-1 px-3 text-foreground hover:bg-foreground/5" />
            <a
              href="/auth/logout"
              className="flex h-10 items-center rounded-md px-3 text-base text-foreground hover:bg-foreground/5"
            >
              Sign out
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
