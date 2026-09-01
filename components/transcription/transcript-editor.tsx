/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { track } from "@/lib/analytics";
import { concatenateDialogueEntriesInTranscriptionJobs } from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import type { DialogueEntry } from "@/src/api/generated";
import PenIcon from "../icons/pen-icon";

interface TranscriptEditorProps {
  currentCitationIndex: number | null;
}

function TranscriptEditor({ currentCitationIndex }: TranscriptEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState<string>("");
  const transcriptRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { transcriptionJobs, saveTranscriptionJob } = useTranscripts();

  const dialogueEntries =
    concatenateDialogueEntriesInTranscriptionJobs(transcriptionJobs);

  useEffect(() => {
    if (
      currentCitationIndex !== null &&
      transcriptRefs.current[currentCitationIndex]
    ) {
      transcriptRefs.current[currentCitationIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentCitationIndex]);

  const handleSpeakerClick = (index: number, speaker: string) => {
    setEditingIndex(index);
    setNewSpeakerName(speaker);
  };

  const handleSpeakerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewSpeakerName(e.target.value);
  };

  const handleSpeakerUpdate = async (
    oldSpeaker: string,
    entryIndex: number,
    updateAll: boolean
  ) => {
    if (newSpeakerName.trim() !== "" && newSpeakerName !== oldSpeaker) {
      try {
        await Promise.all(
          transcriptionJobs.map(async (job) => {
            if (
              job.dialogue_entries.some((entry) =>
                updateAll
                  ? entry.speaker === oldSpeaker
                  : entry === dialogueEntries[entryIndex]
              )
            ) {
              const updatedJob = {
                ...job,
                dialogue_entries: job.dialogue_entries.map((entry) =>
                  // eslint-disable-next-line no-nested-ternary
                  updateAll
                    ? entry.speaker === oldSpeaker
                      ? { ...entry, speaker: newSpeakerName }
                      : entry
                    : entry === dialogueEntries[entryIndex]
                      ? { ...entry, speaker: newSpeakerName }
                      : entry
                ),
              };
              await saveTranscriptionJob(updatedJob);
            }
          })
        );

        track("speaker_name_edited_in_transcript", {
          old_name: oldSpeaker,
          new_name: newSpeakerName,
          update_type: updateAll ? "all_occurrences" : "single_occurrence",
          entry_index: entryIndex,
        });
      } catch (error) {
        console.error(`Failed to update speaker names: ${error}`);
      }
    }
    setEditingIndex(null);
  };

  const getErrorMessages = () => {
    return transcriptionJobs
      .filter((job) => job.error_message)
      .map((job) => ({
        id: job.id,
        message: job.error_message,
      }));
  };

  const errors = getErrorMessages();

  return (
    <div className="w-full overflow-hidden">
      {errors.length > 0 && (
        <div className="mb-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <div className="flex">
            <div className="shrink-0">
              <span className="text-red-600 dark:text-red-400">⚠️</span>
            </div>
            <div className="ml-3">
              {errors.map((error, index) => (
                <div
                  key={error.id}
                  className="text-sm text-red-700 dark:text-red-400"
                >
                  {error.message}
                  {index < errors.length - 1 && <br />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="relative mb-4">
        <div className="flex items-center justify-between">
          <p className="text-neutral-600 dark:text-neutral-400">Transcript:</p>
        </div>
      </div>
      {dialogueEntries.map((entry: DialogueEntry, index: number) => (
        <div
          key={`${entry.start_time}-${entry.end_time}`}
          ref={(el: HTMLDivElement | null) => {
            transcriptRefs.current[index] = el;
          }}
          className={`ph-mask mb-2 flex items-start space-x-2 rounded-md p-2 transition-colors ${
            currentCitationIndex === index
              ? " bg-blue-100 dark:bg-blue-900/30"
              : ""
          }`}
        >
          <Popover
            open={editingIndex === index}
            onOpenChange={(open) => !open && setEditingIndex(null)}
          >
            <PopoverTrigger asChild>
              <div
                className="group flex min-w-[100px] max-w-[200px] cursor-pointer items-start space-x-1"
                onClick={() => handleSpeakerClick(index, entry.speaker)}
              >
                <PenIcon className="mt-1 size-4 shrink-0 text-neutral-400 dark:text-neutral-500 transition-colors group-hover:text-blue-500 dark:group-hover:text-blue-400" />
                <span className="break-words font-bold text-neutral-900 dark:text-neutral-100 group-hover:text-blue-500 dark:group-hover:text-blue-400">
                  {entry.speaker}:
                </span>
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] max-w-80">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium leading-none text-neutral-900 dark:text-neutral-100">
                    Edit Speaker Name
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Update either this occurrence or all occurrences of &apos;
                    {entry.speaker}&apos;:
                  </p>
                </div>
                <div className="grid gap-2">
                  <Input
                    value={newSpeakerName}
                    onChange={handleSpeakerChange}
                    className="col-span-3"
                  />
                  <div className="">
                    <Button
                      onClick={() =>
                        handleSpeakerUpdate(entry.speaker, index, false)
                      }
                      variant="outline"
                      className="hover:bg-neutral-100 dark:hover:bg-neutral-800 border-neutral-200 dark:border-neutral-800"
                    >
                      Update this occurrence
                    </Button>
                    <Button
                      className="mt-2"
                      onClick={() =>
                        handleSpeakerUpdate(entry.speaker, index, true)
                      }
                    >
                      Update all occurrences
                    </Button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <p className="-mx-2 flex-1 cursor-text rounded px-2 py-1 text-neutral-700 dark:text-neutral-300 transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:shadow-sm">
            {entry.text}
          </p>
        </div>
      ))}
    </div>
  );
}

export default TranscriptEditor;
