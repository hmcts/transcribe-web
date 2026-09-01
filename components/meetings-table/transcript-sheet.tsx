"use client";

import * as React from "react";
import {
  SECTION_CONFIG,
  type SectionedTranscript,
  type TranscriptEntry,
  type TranscriptSection,
} from "@/components/audio/dictation/types";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { redactSectionedTranscript } from "@/lib/transcript-redaction";
import { cn } from "@/lib/utils";
import type { MeetingRow } from "./types";

interface TranscriptSheetProps {
  meeting: MeetingRow | null;
  transcript: SectionedTranscript;
  appellantName?: string | null;
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SECTION_ORDER: TranscriptSection[] = ["background", "evidence", "facts"];

const hasTranscriptContent = (transcript: SectionedTranscript) =>
  SECTION_ORDER.some((section) => transcript[section].length > 0);

export function TranscriptSheet({
  meeting,
  transcript,
  appellantName,
  isLoading,
  open,
  onOpenChange,
}: TranscriptSheetProps) {
  const [activeSection, setActiveSection] =
    React.useState<TranscriptSection>("background");
  const [redactPii, setRedactPii] = React.useState(false);
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const sectionRefs = React.useRef<
    Record<TranscriptSection, HTMLDivElement | null>
  >({
    background: null,
    evidence: null,
    facts: null,
  });

  React.useEffect(() => {
    if (!open) {
      setActiveSection("background");
      setRedactPii(false);
      return;
    }

    const firstPopulatedSection =
      SECTION_ORDER.find((section) => transcript[section].length > 0) ??
      "background";
    setActiveSection(firstPopulatedSection);
  }, [open, transcript]);

  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !open || !hasTranscriptContent(transcript)) {
      return;
    }

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let closestSection: TranscriptSection = activeSection;
      let closestOffset = Number.POSITIVE_INFINITY;

      for (const section of SECTION_ORDER) {
        const sectionElement = sectionRefs.current[section];
        if (!sectionElement) {
          continue;
        }

        const offset = Math.abs(
          sectionElement.getBoundingClientRect().top - containerTop - 16
        );

        if (offset < closestOffset) {
          closestOffset = offset;
          closestSection = section;
        }
      }

      setActiveSection((current) =>
        current === closestSection ? current : closestSection
      );
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [activeSection, open, transcript]);

  const scrollToSection = React.useCallback((section: TranscriptSection) => {
    const container = scrollContainerRef.current;
    const sectionElement = sectionRefs.current[section];

    if (!container || !sectionElement) {
      setActiveSection(section);
      return;
    }

    const targetTop = sectionElement.offsetTop - 8;
    container.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: "smooth",
    });
    setActiveSection(section);
  }, []);

  const displayedTranscript = redactPii
    ? redactSectionedTranscript(transcript, { appellantName })
    : transcript;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-hidden sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border pb-4 pr-8">
          <SheetTitle>{meeting?.title ?? "Transcript"}</SheetTitle>
          <SheetDescription>
            Saved transcript loaded from the latest available transcription job.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Redact PII toggle is hidden until the feature is ready for this phase */}
          {false && (
            <div className="flex items-center justify-between gap-4 rounded-lg border-2 border-border bg-muted/30 px-4 py-3 mb-4">
              <div className="space-y-1">
                <Label htmlFor="transcript-pii-redaction-toggle">
                  Redact PII
                </Label>
                <p className="text-xs text-muted-foreground">
                  Replace recognised personal data in this viewer only.
                </p>
              </div>
              <Switch
                id="transcript-pii-redaction-toggle"
                checked={redactPii}
                onCheckedChange={setRedactPii}
                aria-label="Redact personally identifiable information"
              />
            </div>
          )}

          {isLoading && (
            <div className="py-8 text-sm text-muted-foreground">
              Loading transcript...
            </div>
          )}

          {!isLoading && !hasTranscriptContent(displayedTranscript) && (
            <div className="py-8 text-sm text-muted-foreground">
              No saved transcript was found for this hearing.
            </div>
          )}

          {!isLoading && hasTranscriptContent(displayedTranscript) && (
            <>
              <Tabs
                value={activeSection}
                onValueChange={(value) =>
                  scrollToSection(value as TranscriptSection)
                }
                className="w-full"
              >
                <TabsList className="inline-flex h-11 w-full overflow-hidden rounded-md border-2 border-neutral-200 bg-neutral-100 px-0">
                  {SECTION_ORDER.map((section) => {
                    const config = SECTION_CONFIG[section];
                    const count = displayedTranscript[section].length;

                    return (
                      <TabsTrigger
                        key={section}
                        value={section}
                        className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-none px-3 py-2.5 text-xs hover:bg-neutral-200 sm:px-4 sm:text-sm"
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            config.color,
                            activeSection === section
                              ? "animate-pulse"
                              : "opacity-60"
                          )}
                        />
                        <span className="truncate font-medium">
                          {config.label}
                        </span>
                        {count > 0 && (
                          <span className="ml-0.5 rounded-full bg-neutral-300 px-1.5 py-0.5 text-xs">
                            {count}
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>

              <div
                ref={scrollContainerRef}
                className="mt-6 flex-1 overflow-y-auto pr-2"
              >
                <div className="space-y-8 pb-32">
                  {SECTION_ORDER.map((section) => (
                    <div
                      key={section}
                      ref={(element) => {
                        sectionRefs.current[section] = element;
                      }}
                    >
                      <SectionDivider section={section} />

                      {displayedTranscript[section].length === 0 ? (
                        <div className="py-8 text-sm text-muted-foreground">
                          No transcript lines were saved in this section.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {displayedTranscript[section].map((entry, index) => (
                            <TranscriptCard
                              key={`${section}-${entry.speaker}-${entry.timestamp}-${index}`}
                              entry={entry}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SectionDivider({ section }: { section: TranscriptSection }) {
  const config = SECTION_CONFIG[section];

  return (
    <div className="my-2 flex items-center gap-3 py-4">
      <div className="h-px flex-1 bg-neutral-200" />
      <div className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900">
        <span className={cn("size-2 rounded-full", config.color)} />
        <span>{config.label}</span>
      </div>
      <div className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

function TranscriptCard({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className="ph-mask py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="ph-mask text-sm font-medium text-foreground">
          {entry.speaker || "Unknown speaker"}
        </div>
        {entry.timestamp && (
          <div className="text-xs text-muted-foreground">{entry.timestamp}</div>
        )}
      </div>
      <div className="ph-mask prose prose-lg max-w-none whitespace-pre-wrap text-muted-foreground">
        {entry.text}
      </div>
    </div>
  );
}
