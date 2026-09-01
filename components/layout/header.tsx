"use client";

import { FileAudio, HelpCircle, Menu, Shield } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getAdminAccessStatus } from "@/lib/admin-access";
import cn from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";

export default function Header() {
  const { selectedRecordingMode } = useTranscripts();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastScrollY = useRef(0);
  const [isHidden, setIsHidden] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);

  const handleHomeClick = useCallback(() => {
    const hasQueryParams = (searchParams?.toString().length ?? 0) > 0;

    if (pathname === "/" && !hasQueryParams) {
      // Already on clean home page - trigger event to reset view state
      window.dispatchEvent(new CustomEvent("reset-to-welcome"));
    } else {
      // Navigate to clean home (removes query params like ?id=xyz)
      router.push("/");
    }
  }, [router, pathname, searchParams]);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY.current;
      const scrollThreshold = 10;

      // Only trigger if scrolled more than threshold to avoid jitter
      if (Math.abs(currentScrollY - lastScrollY.current) < scrollThreshold) {
        return;
      }

      // Hide header when scrolling down (and not at the very top)
      if (scrollingDown && currentScrollY > 56 && !isHidden) {
        setIsHidden(true);
      }
      // Show header when scrolling up
      else if (!scrollingDown && isHidden) {
        setIsHidden(false);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isHidden]);

  useEffect(() => {
    let cancelled = false;

    const checkAdminAccess = async () => {
      const accessStatus = await getAdminAccessStatus({
        allowLocalhostFallback: true,
      });
      if (!cancelled) {
        setIsAdminUser(accessStatus === "authorised");
      }
    };

    void checkAdminAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  if (pathname === "/coming-soon") {
    return null;
  }

  return (
    <motion.header
      initial={{ y: 0 }}
      animate={{ y: isHidden ? "-100%" : 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="fixed top-0 z-50 w-full border-b border-border bg-background"
    >
      {pathname === "/" && (
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
        >
          Skip to main content
        </a>
      )}
      <div
        className={cn(
          "mx-auto px-4 sm:px-6 h-14 flex items-center justify-between",
          "max-w-[1280px]"
          // "max-w-[70%]"
        )}
      >
        <Link
          href="/"
          onClick={handleHomeClick}
          className="flex h-min items-center gap-2 sm:gap-4"
          aria-label="Judicial Transcribe home"
          title="Judicial Transcribe home"
        >
          <span className="text-xl font-medium text-foreground">
            Judicial Transcribe
          </span>
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          {!selectedRecordingMode && isAdminUser && (
            <Link
              href="/admin"
              className="flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5"
              aria-label="Go to admin"
              title="Go to admin"
            >
              <Shield className="mr-1 size-5" />
              <span className="text-base">Admin</span>
            </Link>
          )}
          {/* MERGE NOTE: entry point for the recording feature area. Without a nav
              link the merged app would ship two unreachable halves rather than
              one application. */}
          {!selectedRecordingMode && (
            <Link
              href="/recording"
              className="flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5"
              aria-label="Go to recordings"
              title="Go to recordings"
            >
              <FileAudio className="mr-1 size-5" />
              <span className="text-base">Recordings</span>
            </Link>
          )}
          {!selectedRecordingMode && (
            <Link
              href="/help"
              className="flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5"
              aria-label="Go to help"
              title="Go to help"
            >
              <HelpCircle className="mr-1 size-5" />
              <span className="text-base">Help</span>
            </Link>
          )}
          <ThemeToggle />
        </nav>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 md:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm p-5">
            <SheetHeader className="mb-4">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-2">
              <SheetClose asChild>
                <Link
                  href="/"
                  onClick={handleHomeClick}
                  className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Home
                </Link>
              </SheetClose>
              {!selectedRecordingMode && isAdminUser && (
                <SheetClose asChild>
                  <Link
                    href="/admin"
                    className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 hover:text-accent-foreground"
                  >
                    <Shield className="size-4" />
                    Admin
                  </Link>
                </SheetClose>
              )}
              {!selectedRecordingMode && (
                <SheetClose asChild>
                  <Link
                    href="/help"
                    className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 hover:text-accent-foreground"
                  >
                    <HelpCircle className="size-4" />
                    Help
                  </Link>
                </SheetClose>
              )}
              <div className="mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-sm font-medium text-foreground">
                  Theme
                </span>
                <ThemeToggle />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </motion.header>
  );
}
