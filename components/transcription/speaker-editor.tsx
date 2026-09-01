/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";
import { concatenateDialogueEntriesInTranscriptionJobs } from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import type { DialogueEntry } from "@/src/api/generated";
import PenIcon from "../icons/pen-icon";

function SpeakerEditor() {
  const [speakerMap, setSpeakerMap] = useState<Map<string, DialogueEntry>>(
    new Map()
  );
  const [editingSpeaker, setEditingSpeaker] = useState<string>("");
  const [newSpeakerName, setNewSpeakerName] = useState<string>("");
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null
  );
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const { transcriptionJobs, saveTranscriptionJob, audioBlob } =
    useTranscripts();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const newSpeakerMap = new Map();
    const dialogueEntries =
      concatenateDialogueEntriesInTranscriptionJobs(transcriptionJobs);
    dialogueEntries.forEach((entry: DialogueEntry) => {
      if (!newSpeakerMap.has(entry.speaker)) {
        newSpeakerMap.set(entry.speaker, entry);
      }
    });
    setSpeakerMap(newSpeakerMap);
  }, [transcriptionJobs]);

  useEffect(() => {
    if (audioBlob) {
      const audio = new Audio(URL.createObjectURL(audioBlob));
      setAudioElement(audio);

      return () => {
        URL.revokeObjectURL(audio.src);
      };
    }
    return undefined;
  }, [audioBlob]);

  const handleSpeakerUpdate = async (oldSpeaker: string) => {
    if (
      newSpeakerName.trim() !== "" &&
      newSpeakerName !== oldSpeaker &&
      transcriptionJobs
    ) {
      try {
        // Update all transcription jobs that contain the speaker
        await Promise.all(
          transcriptionJobs.map(async (job) => {
            if (
              job.dialogue_entries.some((entry) => entry.speaker === oldSpeaker)
            ) {
              const updatedJob = {
                ...job,
                dialogue_entries: job.dialogue_entries.map((entry) =>
                  entry.speaker === oldSpeaker
                    ? { ...entry, speaker: newSpeakerName }
                    : entry
                ),
              };
              await saveTranscriptionJob(updatedJob);
            }
          })
        );

        track("speaker_name_edited_in_sample_editor", {
          old_name: oldSpeaker,
          new_name: newSpeakerName,
        });

        setEditingSpeaker("");
        setNewSpeakerName("");
      } catch (error) {
        console.error("Failed to update speaker names:", error);
      }
    }
  };

  const playAudioSegment = (entry: DialogueEntry) => {
    if (!audioBlob) return;

    if (audioElement) {
      const checkTime = () => {
        if (audioElement.currentTime >= entry.end_time) {
          audioElement.pause();
          setIsPlaying(null);
          audioElement.removeEventListener("timeupdate", checkTime);
        }
      };

      if (isPlaying === entry.speaker) {
        audioElement.pause();
        setIsPlaying(null);
        audioElement.removeEventListener("timeupdate", checkTime);
        return;
      }

      audioElement.currentTime = entry.start_time;
      audioElement.play();
      setIsPlaying(entry.speaker);
      track("speaker_audio_sample_played", {
        speaker: entry.speaker,
        segment_duration: entry.end_time - entry.start_time,
        start_time: entry.start_time,
      });

      audioElement.addEventListener("timeupdate", checkTime);
    }
  };

  useEffect(() => {
    if (editingSpeaker && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSpeaker]);

  return (
    <div className="mb-6">
      <div className="space-y-4">
        {Array.from(speakerMap.entries()).map(([speaker, entry]) => {
          const isEditing = editingSpeaker === speaker;
          const isPlayingThis = isPlaying === speaker;

          return (
            <div
              key={speaker}
              className="flex w-full items-center justify-between"
            >
              {isEditing ? (
                <div className="flex items-center space-x-2">
                  <Input
                    ref={inputRef}
                    value={newSpeakerName}
                    onChange={(e) => setNewSpeakerName(e.target.value)}
                    placeholder="Enter new speaker name"
                    aria-label={`New name for ${speaker}`}
                    className="max-w-xs"
                  />
                  <Button onClick={() => handleSpeakerUpdate(speaker)}>
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingSpeaker("");
                      setNewSpeakerName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div
                  className="group flex min-w-[100px] cursor-pointer items-center justify-start space-x-1"
                  onClick={() => {
                    setEditingSpeaker(speaker);
                    setNewSpeakerName(speaker);
                  }}
                >
                  <PenIcon className="size-4 text-gray-400 transition-colors group-hover:text-blue-500" />
                  <span className="font-bold group-hover:text-blue-500">
                    {entry.speaker}:
                  </span>
                </div>
              )}
              <HoverCard openDelay={50} closeDelay={0}>
                <HoverCardTrigger>
                  <Button
                    variant="outline"
                    onClick={() => audioBlob && playAudioSegment(entry)}
                    className={`flex min-w-[140px] items-center gap-2 ${
                      !audioBlob
                        ? "cursor-not-allowed opacity-50 hover:opacity-50"
                        : ""
                    }`}
                    disabled={!audioBlob}
                  >
                    {isPlayingThis ? (
                      <>
                        <Pause className="size-4" />
                        Pause Sample
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        Play Sample
                      </>
                    )}
                  </Button>
                </HoverCardTrigger>
                {!audioBlob && (
                  <HoverCardContent className="w-80">
                    <div className="flex items-center space-x-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold">
                          Audio Unavailable
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          Minute does not save audio. Only transcriptions are
                          saved.
                        </p>
                      </div>
                    </div>
                  </HoverCardContent>
                )}
              </HoverCard>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SpeakerEditor;
