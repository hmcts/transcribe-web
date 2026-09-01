"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedShinyText } from "@/components/animated-shiny-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import cn from "@/lib/utils";
import type {
  MessageGroup,
  SectionedTranscript,
  TranscriptEntry,
  TranscriptSection,
} from "./types";
import { SECTION_CONFIG } from "./types";

const SPEAKER_NAME_EDITING_ENABLED = false;

interface TranscriptEditorProps {
  sectionedTranscript: SectionedTranscript;
  activeSection: TranscriptSection;
  /** The section where the current interim speech will actually be saved (may differ from activeSection if user switched tabs mid-speech) */
  interimTargetSection: TranscriptSection | null;
  interimText: string;
  isListening: boolean;
  onTranscriptUpdate: (updatedTranscript: SectionedTranscript) => void;
}

// Section divider component
function SectionDivider({
  section,
  isActive,
}: {
  section: TranscriptSection;
  isActive: boolean;
}) {
  const config = SECTION_CONFIG[section];
  return (
    <div className="flex items-center gap-3 py-4 my-2">
      <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
          isActive
            ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            : "bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400"
        )}
      >
        <span className={cn("size-2 rounded-full", config.color)} />
        <span>{config.label}</span>
      </div>
      <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

const TIME_GAP_THRESHOLD = 60000; // 1 minute in milliseconds

// Helper to get total message count
const getTotalCount = (sectioned: SectionedTranscript): number =>
  sectioned.background.length +
  sectioned.evidence.length +
  sectioned.facts.length;

// Type for tracking which section/index we're editing
interface EditLocation {
  section: TranscriptSection;
  index: number;
}

const getMessageControlKey = (section: TranscriptSection, index: number) =>
  `${section}-${index}`;

export default function TranscriptEditor({
  sectionedTranscript,
  activeSection,
  interimTargetSection,
  interimText,
  isListening,
  onTranscriptUpdate,
}: TranscriptEditorProps) {
  // Determine which section the interim text will actually be saved to
  // Falls back to activeSection when no speech is in progress (interimTargetSection is null)
  const effectiveInterimSection = interimTargetSection ?? activeSection;
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editingMessage, setEditingMessage] = useState<EditLocation | null>(
    null
  );
  const [messageEditValue, setMessageEditValue] = useState<string>("");
  const [confirmingDelete, setConfirmingDelete] = useState<EditLocation | null>(
    null
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const totalCount = getTotalCount(sectionedTranscript);
  const interimSnapshot = interimText;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const hasUpdates = totalCount > 0 || interimSnapshot.length > 0;
    if (scrollContainerRef.current && hasUpdates) {
      // Scroll the container to the bottom, not the page
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [totalCount, interimSnapshot]);

  // Extended message group with section info
  interface SectionMessageGroup extends MessageGroup {
    section: TranscriptSection;
    sectionIndex: number; // Index within the section
  }

  // Group messages by section, then by speaker and time
  const sectionGroups = useMemo(() => {
    const allGroups: {
      section: TranscriptSection;
      groups: SectionMessageGroup[];
    }[] = [];
    const sections: TranscriptSection[] = ["background", "evidence", "facts"];

    for (const section of sections) {
      const entries = sectionedTranscript[section];
      if (entries.length === 0) continue;

      const groups: SectionMessageGroup[] = [];

      entries.forEach((entry, index) => {
        const prevEntry = index > 0 ? entries[index - 1] : null;
        const currentTimeMs = entry.timestampMs || Date.now();
        const prevTimeMs = prevEntry?.timestampMs || 0;

        // Check if we should start a new group
        const shouldStartNewGroup =
          !prevEntry || // First entry
          prevEntry.speaker !== entry.speaker || // Different speaker
          currentTimeMs - prevTimeMs > TIME_GAP_THRESHOLD; // More than 1 minute gap

        if (shouldStartNewGroup) {
          // Start a new group
          groups.push({
            speaker: entry.speaker,
            messages: [{ text: entry.text, index, timestamp: entry.timestamp }],
            startTime: entry.timestamp,
            startTimeMs: currentTimeMs,
            section,
            sectionIndex: index,
          });
        } else {
          // Add to existing group
          const lastGroup = groups[groups.length - 1];
          if (lastGroup) {
            lastGroup.messages.push({
              text: entry.text,
              index,
              timestamp: entry.timestamp,
            });
          }
        }
      });

      if (groups.length > 0) {
        allGroups.push({ section, groups });
      }
    }

    return allGroups;
  }, [sectionedTranscript]);

  const handleStartEditSpeaker = (speaker: string) => {
    setEditingSpeaker(speaker);
    setEditValue(speaker);
  };

  const handleCancelEdit = () => {
    setEditingSpeaker(null);
    setEditValue("");
  };

  const handleStartEditMessage = (
    section: TranscriptSection,
    index: number,
    text: string
  ) => {
    setEditingMessage({ section, index });
    setMessageEditValue(text);
  };

  const restoreMessageFocus = (location: EditLocation | null) => {
    if (!location) {
      return;
    }

    requestAnimationFrame(() => {
      messageButtonRefs.current
        .get(getMessageControlKey(location.section, location.index))
        ?.focus();
    });
  };

  const handleCancelMessageEdit = () => {
    const currentEditingLocation = editingMessage;
    setEditingMessage(null);
    setMessageEditValue("");
    restoreMessageFocus(currentEditingLocation);
  };

  const handleSaveMessageEdit = () => {
    if (!editingMessage) return;
    const newText = messageEditValue.trim();
    if (newText === "") {
      handleCancelMessageEdit();
      return;
    }

    const { section, index } = editingMessage;
    const updatedSection = sectionedTranscript[section].map((entry, idx) =>
      idx === index ? { ...entry, text: newText } : entry
    );

    onTranscriptUpdate({
      ...sectionedTranscript,
      [section]: updatedSection,
    });
    setEditingMessage(null);
    setMessageEditValue("");
    restoreMessageFocus(editingMessage);
  };

  const handleDeleteClick = (section: TranscriptSection, index: number) => {
    // Check if this message is already in confirm state
    if (
      confirmingDelete?.section === section &&
      confirmingDelete?.index === index
    ) {
      // Second click - actually delete
      const updatedSection = sectionedTranscript[section].filter(
        (_, idx) => idx !== index
      );

      onTranscriptUpdate({
        ...sectionedTranscript,
        [section]: updatedSection,
      });
      setConfirmingDelete(null);
    } else {
      // First click - enter confirm state
      setConfirmingDelete({ section, index });
    }
  };

  const handleCancelDelete = () => {
    setConfirmingDelete(null);
  };

  useEffect(() => {
    const textarea = editingTextareaRef.current;
    if (!textarea || !editingMessage) {
      return;
    }

    textarea.focus();
    const textLength = textarea.value.length;
    textarea.setSelectionRange(textLength, textLength);
  }, [editingMessage]);

  useEffect(() => {
    const textarea = editingTextareaRef.current;
    if (!textarea || !editingMessage) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [editingMessage]);

  const handleMessageKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveMessageEdit();
    } else if (e.key === "Escape") {
      handleCancelMessageEdit();
    }
  };

  const handleUpdateSpeaker = (
    oldSpeaker: string,
    updateAll: boolean,
    targetSection?: TranscriptSection,
    targetIndices?: number[]
  ) => {
    if (editValue.trim() === "" || editValue === oldSpeaker) {
      handleCancelEdit();
      return;
    }

    const newSpeaker = editValue.trim();

    // Update speaker in a section
    const updateSection = (
      entries: TranscriptEntry[],
      section: TranscriptSection
    ) => {
      if (updateAll) {
        // Update all occurrences across all sections
        return entries.map((entry) =>
          entry.speaker === oldSpeaker
            ? { ...entry, speaker: newSpeaker }
            : entry
        );
      }

      // Single group update: only update if this is the target section
      // and only the specific indices in that group
      if (targetSection && targetIndices && section === targetSection) {
        const indexSet = new Set(targetIndices);
        return entries.map((entry, idx) =>
          indexSet.has(idx) && entry.speaker === oldSpeaker
            ? { ...entry, speaker: newSpeaker }
            : entry
        );
      }

      // Not the target section, return unchanged
      return entries;
    };

    onTranscriptUpdate({
      background: updateSection(sectionedTranscript.background, "background"),
      evidence: updateSection(sectionedTranscript.evidence, "evidence"),
      facts: updateSection(sectionedTranscript.facts, "facts"),
    });

    handleCancelEdit();
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    speaker: string,
    section: TranscriptSection,
    messageIndices: number[]
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        handleUpdateSpeaker(speaker, true);
      } else {
        handleUpdateSpeaker(speaker, false, section, messageIndices);
      }
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <span id="transcript-edit-button-hint" className="sr-only">
        Activate to edit this message. Press Escape to cancel.
      </span>
      <div
        ref={scrollContainerRef}
        className="prose sm:prose-xl min-h-0 min-w-full prose-neutral dark:prose-invert flex-1 overflow-y-auto p-2 prose-p:my-1 prose-headings:mb-2"
      >
        {sectionGroups.length === 0 && !interimText && !isListening ? (
          <div className="flex h-full items-center justify-center">
            <div className="not-prose text-center">
              <AnimatedShinyText>
                Click &apos;Start recording&apos; to begin
              </AnimatedShinyText>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4">
            {/* Show active section divider first if no messages yet but listening */}
            {sectionGroups.length === 0 && isListening && (
              <SectionDivider section={activeSection} isActive={true} />
            )}

            {sectionGroups.map(({ section, groups }, _sectionIdx) => (
              <div key={`section-${section}`}>
                {/* Section divider */}
                <SectionDivider
                  section={section}
                  isActive={activeSection === section}
                />

                {/* Message groups in this section */}
                {groups.map((group, groupIndex) => (
                  <div
                    key={`group-${section}-${groupIndex}`}
                    className="group/group"
                  >
                    {/* Speaker header */}
                    <div className="mb-2 flex items-center gap-2">
                      {SPEAKER_NAME_EDITING_ENABLED ? (
                        <Popover
                          open={editingSpeaker === group.speaker}
                          onOpenChange={(open) => {
                            if (!open) handleCancelEdit();
                          }}
                        >
                          <PopoverTrigger asChild>
                            <button
                              className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              onClick={() =>
                                handleStartEditSpeaker(group.speaker)
                              }
                            >
                              <span className="font-semibold text-primary">
                                {group.speaker}
                              </span>
                              <Pencil className="size-3 text-neutral-400 dark:text-neutral-500 opacity-0 transition-opacity group-hover/group:opacity-100" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[calc(100vw-2rem)] max-w-80">
                            <div className="not-prose grid gap-4">
                              <div className="space-y-2">
                                <h4 id="edit-speaker-name-label" className="font-medium leading-none">
                                  Edit Speaker Name
                                </h4>
                                <p className="text-sm text-muted-foreground">
                                  Update this occurrence or all occurrences of
                                  &apos;
                                  {group.speaker}&apos;
                                </p>
                              </div>
                              <div className="grid gap-2">
                                <Input
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  placeholder="New speaker name"
                                  aria-labelledby="edit-speaker-name-label"
                                  onKeyDown={(e) =>
                                    handleKeyDown(
                                      e,
                                      group.speaker,
                                      group.section,
                                      group.messages.map((m) => m.index)
                                    )
                                  }
                                  autoFocus
                                />
                                <Button
                                  onClick={() =>
                                    handleUpdateSpeaker(
                                      group.speaker,
                                      false,
                                      group.section,
                                      group.messages.map((m) => m.index)
                                    )
                                  }
                                  variant="outline"
                                  size="sm"
                                >
                                  Update this group
                                </Button>
                                <Button
                                  onClick={() =>
                                    handleUpdateSpeaker(group.speaker, true)
                                  }
                                  size="sm"
                                >
                                  Update all occurrences
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <div className="px-2 py-1">
                          <span className="font-semibold text-primary">
                            {group.speaker}
                          </span>
                        </div>
                      )}

                      <span className="text-xs text-neutral-600 dark:text-neutral-400">
                        {group.startTime}
                      </span>
                    </div>

                    {/* Messages in group */}
                    <div className="space-y-2">
                      {group.messages.map((message, messageIndex) => {
                        const isEditingThisMessage =
                          editingMessage?.section === section &&
                          editingMessage?.index === message.index;
                        const messageEditInstructionsId = `transcript-message-edit-instructions-${section}-${message.index}`;

                        return (
                          <div
                            key={`message-${section}-${groupIndex}-${messageIndex}`}
                            className="group/message flex items-start gap-2"
                          >
                            {isEditingThisMessage ? (
                              <div className="flex w-full flex-col gap-2">
                                <textarea
                                  ref={editingTextareaRef}
                                  value={messageEditValue}
                                  onChange={(e) =>
                                    setMessageEditValue(e.target.value)
                                  }
                                  onKeyDown={handleMessageKeyDown}
                                  aria-describedby={messageEditInstructionsId}
                                  aria-label={`Edit transcript message from ${group.speaker}`}
                                  className="w-full resize-none rounded border border-neutral-300 bg-white px-4 py-1 text-inherit focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
                                  style={{
                                    fontSize: "inherit",
                                    lineHeight: "inherit",
                                    overflow: "hidden",
                                  }}
                                />
                                <div
                                  id={messageEditInstructionsId}
                                  className="not-prose flex items-center gap-2 text-xs text-neutral-500"
                                >
                                  <Button
                                    size="sm"
                                    onClick={handleSaveMessageEdit}
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleCancelMessageEdit}
                                  >
                                    Cancel
                                  </Button>
                                  <span className="ml-2">
                                    Press Ctrl+Enter to save, Esc to cancel
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  aria-roledescription="editable transcript"
                                  aria-label={`${group.speaker}: ${message.text}`}
                                  aria-describedby="transcript-edit-button-hint"
                                  ref={(node) => {
                                    const controlKey = getMessageControlKey(
                                      section,
                                      message.index
                                    );

                                    if (node) {
                                      messageButtonRefs.current.set(
                                        controlKey,
                                        node
                                      );
                                      return;
                                    }

                                    messageButtonRefs.current.delete(
                                      controlKey
                                    );
                                  }}
                                  className="flex-1 cursor-text rounded border border-transparent px-4 py-1 text-left transition hover:border-neutral-300 hover:bg-neutral-100 hover:shadow-sm focus-visible:border-accent focus-visible:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:border-neutral-600 dark:hover:bg-neutral-800 dark:focus-visible:border-accent dark:focus-visible:bg-accent/15 dark:focus-visible:ring-accent"
                                  onClick={() =>
                                    handleStartEditMessage(
                                      section,
                                      message.index,
                                      message.text
                                    )
                                  }
                                >
                                  {message.text}
                                </button>
                                {(() => {
                                  const isConfirming =
                                    confirmingDelete?.section === section &&
                                    confirmingDelete?.index === message.index;
                                  return (
                                    <button
                                      onClick={() =>
                                        handleDeleteClick(
                                          section,
                                          message.index
                                        )
                                      }
                                      onBlur={handleCancelDelete}
                                      className={cn(
                                        "not-prose flex-shrink-0 rounded transition-all flex items-center justify-center",
                                        // Square button matching line height (text-xl ~1.75rem + py-1 = ~2.25rem total, so use size-9 = 2.25rem)
                                        "size-9",
                                        isConfirming
                                          ? "bg-red-500 text-white dark:bg-red-600 opacity-100"
                                          : "text-neutral-600 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover/message:opacity-100 focus-visible:opacity-100 focus-visible:bg-red-100 focus-visible:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-neutral-400 dark:hover:bg-red-900/30 dark:hover:text-red-400 dark:focus-visible:bg-red-900/30 dark:focus-visible:text-red-400 dark:focus-visible:ring-red-400"
                                      )}
                                      title={
                                        isConfirming
                                          ? "Click again to delete"
                                          : "Delete message"
                                      }
                                    >
                                      {isConfirming ? (
                                        <Check className="size-4" />
                                      ) : (
                                        <Trash2 className="size-4" />
                                      )}
                                    </button>
                                  );
                                })()}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Show section divider for target section if it has no messages yet but we're recording to it */}
            {sectionGroups.length > 0 &&
              !sectionGroups.some(
                (sg) => sg.section === effectiveInterimSection
              ) &&
              interimText && (
                <SectionDivider
                  section={effectiveInterimSection}
                  isActive={true}
                />
              )}

            {/* Interim text (while speaking) - shows target section where message will be saved */}
            {interimText && (
              <div className="not-prose animate-pulse">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      SECTION_CONFIG[effectiveInterimSection].color
                    )}
                  />
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    Recording to {SECTION_CONFIG[effectiveInterimSection].label}
                  </span>
                </div>
                <div className="mb-2">
                  <span className="font-semibold text-primary">
                    {interimText.split(": ")[0]}
                  </span>
                </div>
                <div className="pl-4">
                  <p className="italic text-neutral-400 dark:text-neutral-500">
                    {interimText.split(": ").slice(1).join(": ")}
                  </p>
                </div>
              </div>
            )}

            {/* Invisible div for auto-scroll anchor */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
