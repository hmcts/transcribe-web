"use client";

import {
  FileAudio,
  HelpCircle,
  Menu,
  Mic,
  PenLine,
  Shield,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextSwitcher } from "@/components/access/context-switcher";
import { DevPersonaPicker } from "@/components/access/dev-persona-picker";
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
import {
  DICTATION_BASE_PATH,
  DICTATION_HREF,
  HEARING_RECORDINGS_HREF,
  isPathActive,
} from "@/lib/navigation";
import { inSentence } from "@/lib/jurisdiction-wording";
import cn from "@/lib/utils";
import { useAccess } from "@/providers/access";
import { useJurisdiction } from "@/providers/jurisdiction";
import { useDictationEnabled } from "@/providers/runtime-flags";
import { useTranscripts } from "@/providers/transcripts";

export default function Header() {
  const { isRecording, selectedRecordingMode, isProcessingTranscription } =
    useTranscripts();
  // Hide the links away from the current page while a session is live: a
  // client-side navigation would unmount it, and the provider's beforeunload
  // and popstate guards do not catch <Link> clicks. Live dictation on /record
  // sets isRecording, not selectedRecordingMode.
  const hideNavLinks = Boolean(selectedRecordingMode) || isRecording;
  // DIAAT-332: no switching jurisdiction while an upload is being processed.
  const hideSwitcher = hideNavLinks || Boolean(isProcessingTranscription);
  // DIAAT-373: every link is shown from the permissions of the active context,
  // never from a role name. DIAAT-330: hearing recordings also only where the
  // jurisdiction uses them, in its words.
  const { can, active } = useAccess();
  // DIAAT-392: the runtime flag, else the deploy-time default.
  const dictationEnabled = useDictationEnabled();
  const { current, hasHearingRecordings, wording } = useJurisdiction();
  const canAdmin = can("admin.access");
  // DIAAT-356: whoever may edit the jurisdiction's wording reaches its editor.
  // Only while working in a jurisdiction: a global role has none to edit here
  // (the API answers 403 `no_jurisdiction`), and changes a jurisdiction's wording
  // from Admin, Jurisdictions.
  const canEditWording =
    can("jurisdiction.wording.edit") && Boolean(active?.jurisdiction);
  const recordingsLabel = wording("nav.recordings");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastScrollY = useRef(0);
  const [isHidden, setIsHidden] = useState(false);
  const showDictation =
    !hideNavLinks && dictationEnabled && can("dictation.use");
  const showRecordings =
    !hideNavLinks && can("recording.own") && hasHearingRecordings;
  const isDictationActive = isPathActive(pathname, DICTATION_BASE_PATH);
  const isHearingRecordingsActive = isPathActive(
    pathname,
    HEARING_RECORDINGS_HREF
  );

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
          aria-label="Bench Notes home"
          title="Bench Notes home"
        >
          <span className="text-xl font-medium text-foreground">
            Bench Notes
          </span>
        </Link>

        <nav className="hidden items-center gap-2 lg:flex">
          {!hideNavLinks && canAdmin && (
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
          {!hideNavLinks && canEditWording && (
            <Link
              href="/jurisdiction-wording"
              className="flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5"
              title={`Change ${current?.code ?? ""} wording`}
            >
              <PenLine className="mr-1 size-5" />
              <span className="text-base">Wording</span>
            </Link>
          )}
          {/* MERGE NOTE: entry points for both feature areas (dictation and
              hearing recordings). Without nav links the merged app would ship
              two unreachable halves rather than one application. */}
          {showDictation && (
            <Link
              href={DICTATION_HREF}
              className={cn(
                "flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5",
                isDictationActive && "bg-foreground/5"
              )}
              aria-label="Go to dictation"
              aria-current={isDictationActive ? "page" : undefined}
              title="Go to dictation"
            >
              <Mic className="mr-1 size-5" />
              <span className="text-base">Dictation</span>
            </Link>
          )}
          {showRecordings && (
            <Link
              href={HEARING_RECORDINGS_HREF}
              className={cn(
                "flex h-10 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors duration-100 hover:bg-foreground/5",
                isHearingRecordingsActive && "bg-foreground/5"
              )}
              aria-label={`Go to ${inSentence(recordingsLabel)}`}
              aria-current={isHearingRecordingsActive ? "page" : undefined}
              title={`Go to ${inSentence(recordingsLabel)}`}
            >
              <FileAudio className="mr-1 size-5" />
              <span className="text-base">{recordingsLabel}</span>
            </Link>
          )}
          {!hideNavLinks && (
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
          {!hideSwitcher && (
            <ContextSwitcher className="flex h-10 items-center gap-1 px-3 text-foreground hover:bg-foreground/5" />
          )}
          <DevPersonaPicker className="flex h-10 items-center gap-1 px-3 text-foreground hover:bg-foreground/5" />
          <ThemeToggle />
        </nav>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 lg:hidden"
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
              {!hideSwitcher && (
                <ContextSwitcher className="h-10 justify-start px-3 text-sm font-medium" />
              )}
              <DevPersonaPicker className="h-10 justify-start px-3 text-sm font-medium" />
              <SheetClose asChild>
                <Link
                  href="/"
                  onClick={handleHomeClick}
                  className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Home
                </Link>
              </SheetClose>
              {!hideNavLinks && canAdmin && (
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
              {!hideNavLinks && canEditWording && (
                <SheetClose asChild>
                  <Link
                    href="/jurisdiction-wording"
                    className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 hover:text-accent-foreground"
                  >
                    <PenLine className="size-4" />
                    Wording
                  </Link>
                </SheetClose>
              )}
              {showDictation && (
                <SheetClose asChild>
                  <Link
                    href={DICTATION_HREF}
                    aria-current={isDictationActive ? "page" : undefined}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 hover:text-accent-foreground",
                      isDictationActive && "bg-foreground/5"
                    )}
                  >
                    <Mic className="size-4" />
                    Dictation
                  </Link>
                </SheetClose>
              )}
              {showRecordings && (
                <SheetClose asChild>
                  <Link
                    href={HEARING_RECORDINGS_HREF}
                    aria-current={
                      isHearingRecordingsActive ? "page" : undefined
                    }
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 hover:text-accent-foreground",
                      isHearingRecordingsActive && "bg-foreground/5"
                    )}
                  >
                    <FileAudio className="size-4" />
                    {recordingsLabel}
                  </Link>
                </SheetClose>
              )}
              {!hideNavLinks && (
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
