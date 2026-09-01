import { CalendarIcon, PencilIcon, UsersIcon } from "lucide-react";
/* eslint-disable jsx-a11y/no-autofocus */
import { useEffect, useState } from "react";
import { CardHeader } from "@/components/ui/card";
import {
  concatenateDialogueEntriesInTranscriptionJobs,
  DEFAULT_MEETING_TITLE,
  replaceSpeakerInDialogueEntries,
} from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import type { DialogueEntry, Transcription } from "@/src/api/generated";
import TagManager from "./tag-manager";

interface DialogueHeaderProps {
  currentTranscription: Transcription | null;
}

export default function DialogueHeader({
  currentTranscription,
}: DialogueHeaderProps) {
  const { renameTranscription, transcriptionJobs, saveTranscriptionJob } =
    useTranscripts();
  const [isEditing, setIsEditing] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<string>("");
  const [newSpeakerName, setNewSpeakerName] = useState<string>("");
  const [newTitle, setNewTitle] = useState(
    currentTranscription?.title || DEFAULT_MEETING_TITLE
  );

  useEffect(() => {
    setNewTitle(currentTranscription?.title || DEFAULT_MEETING_TITLE);
  }, [currentTranscription?.title]);

  const dialogueEntries =
    concatenateDialogueEntriesInTranscriptionJobs(transcriptionJobs);
  const uniqueSpeakers: string[] = dialogueEntries
    ? Array.from(
        new Set(dialogueEntries.map((entry: DialogueEntry) => entry.speaker))
      )
    : [];

  const onTitleEdit = async () => {
    if (isEditing && currentTranscription?.id && newTitle) {
      await renameTranscription(currentTranscription.id, newTitle);
    }
    setIsEditing(!isEditing);
  };

  const handleSpeakerUpdate = async (oldSpeaker: string) => {
    if (newSpeakerName.trim() === "" || newSpeakerName === oldSpeaker) {
      return;
    }

    const updatedJobs = transcriptionJobs.map((job) => ({
      ...job,
      dialogue_entries: replaceSpeakerInDialogueEntries(
        job.dialogue_entries,
        oldSpeaker,
        newSpeakerName
      ),
    }));

    await Promise.all(updatedJobs.map(saveTranscriptionJob));

    setEditingSpeaker("");
    setNewSpeakerName("");
  };

  return (
    <CardHeader className="space-y-4">
      <div className="flex items-center gap-2">
        {isEditing ? (
          <input
            type="text"
            value={newTitle || ""}
            onChange={(e) => setNewTitle(e.target.value)}
            className="ph-mask mb-0 rounded-md bg-muted/50 px-2 py-1 text-2xl font-bold"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onTitleEdit();
              } else if (e.key === "Escape") {
                setIsEditing(false);
                setNewTitle(
                  currentTranscription?.title || DEFAULT_MEETING_TITLE
                );
              }
            }}
            onBlur={() => {
              onTitleEdit();
            }}
          />
        ) : (
          <h1
            className="ph-mask mb-0 rounded-md px-2 py-1 text-left text-2xl font-bold transition-colors hover:cursor-pointer hover:bg-muted"
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsEditing(true);
              }
            }}
            aria-label="Edit meeting title"
          >
            {currentTranscription?.title || DEFAULT_MEETING_TITLE}
          </h1>
        )}
        <button
          className="text-muted-foreground hover:text-foreground"
          aria-label={isEditing ? "Save title" : "Edit title"}
          onClick={onTitleEdit}
          type="button"
        >
          <PencilIcon className="size-4" />
        </button>
      </div>

      <div className="flex flex-col space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <CalendarIcon className="size-4" />
          <span>
            {currentTranscription?.created_datetime
              ? new Date(
                  currentTranscription.created_datetime
                ).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "Date not set"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <UsersIcon className="size-4" />
          <div className="flex flex-wrap gap-2">
            {uniqueSpeakers.map((speaker: string, index: number) =>
              editingSpeaker === speaker ? (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={newSpeakerName}
                    onChange={(e) => setNewSpeakerName(e.target.value)}
                    className="h-6 w-32 rounded-full bg-muted px-2.5 py-0.5 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSpeakerUpdate(speaker);
                      } else if (e.key === "Escape") {
                        setEditingSpeaker("");
                        setNewSpeakerName("");
                      }
                    }}
                    onBlur={() => {
                      handleSpeakerUpdate(speaker);
                    }}
                  />
                </div>
              ) : (
                <button
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  type="button"
                  onClick={() => {
                    setEditingSpeaker(speaker);
                    setNewSpeakerName(speaker);
                  }}
                  className="group inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium hover:bg-muted/80"
                >
                  <span>{speaker}</span>
                  <PencilIcon className="size-3" />
                </button>
              )
            )}
          </div>
        </div>

        {currentTranscription?.id && (
          <TagManager transcriptionId={currentTranscription.id} />
        )}
      </div>
    </CardHeader>
  );
}
