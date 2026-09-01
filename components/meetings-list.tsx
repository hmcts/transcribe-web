"use client";

import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import React from "react";
import { toast } from "sonner";
import type { SectionedTranscript } from "@/components/audio/dictation/types";
import { MeetingsDataTable } from "@/components/meetings-table/data-table";
import { TranscriptSheet } from "@/components/meetings-table/transcript-sheet";
import {
  DONE_MEETING_TAG,
  extractHearingTypes,
  isDoneMeeting,
  type MeetingRow,
} from "@/components/meetings-table/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api-client";
import {
  addTagToTranscription,
  getTranscriptionJobs,
  removeTagFromTranscription,
} from "@/lib/database";
import { downloadTranscriptDocument } from "@/lib/download";
import { DEFAULT_MEETING_TITLE } from "@/lib/utils";
import { useTranscripts } from "@/providers/transcripts";
import type { DialogueEntry } from "@/src/api/generated";
import type { TranscriptionMetadata } from "@/src/api/generated/models/TranscriptionMetadata";

interface MeetingsListProps {
  isLoading: boolean;
  meetings: TranscriptionMetadata[];
}

interface TranscriptViewerResponse {
  messages: SectionedTranscript;
  appellantName?: string | null;
}

const EMPTY_SECTIONED_TRANSCRIPT: SectionedTranscript = {
  background: [],
  evidence: [],
  facts: [],
};

const buildFallbackTranscript = (
  entries: DialogueEntry[]
): SectionedTranscript => ({
  background: entries.map((entry) => {
    const timestampMs =
      typeof entry.start_time === "number"
        ? Math.round(entry.start_time * 1000)
        : undefined;

    return {
      speaker: entry.speaker,
      text: entry.text,
      timestamp:
        timestampMs && timestampMs > 0
          ? format(new Date(timestampMs), "p")
          : "",
      timestampMs,
    };
  }),
  evidence: [],
  facts: [],
});

function MeetingsList({ isLoading, meetings }: MeetingsListProps) {
  const { deleteTranscription, renameTranscription, refreshMetadata } =
    useTranscripts();

  const [meetingToPreview, setMeetingToPreview] =
    React.useState<MeetingRow | null>(null);
  const [previewTranscript, setPreviewTranscript] =
    React.useState<SectionedTranscript>(EMPTY_SECTIONED_TRANSCRIPT);
  const [previewAppellantName, setPreviewAppellantName] = React.useState<
    string | null
  >(null);
  const [isPreviewLoading, setIsPreviewLoading] = React.useState(false);
  const [meetingToDelete, setMeetingToDelete] =
    React.useState<MeetingRow | null>(null);
  const [meetingToRename, setMeetingToRename] =
    React.useState<MeetingRow | null>(null);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [isDeletingMeeting, setIsDeletingMeeting] = React.useState(false);
  const [isRenamingMeeting, setIsRenamingMeeting] = React.useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);
  const [isUpdatingDoneState, setIsUpdatingDoneState] = React.useState(false);

  const formatReadableDate = React.useCallback((date: string | null) => {
    if (!date) {
      return "Unknown date";
    }

    const meetingDate = new Date(date);

    if (isToday(meetingDate)) {
      return `Today at ${format(meetingDate, "p")}`;
    }
    if (isYesterday(meetingDate)) {
      return `Yesterday at ${format(meetingDate, "p")}`;
    }
    if (meetingDate > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
      return `${formatDistanceToNow(meetingDate, {
        addSuffix: true,
      })} at ${format(meetingDate, "p")}`;
    }
    return format(meetingDate, "PP 'at' p");
  }, []);

  const formatExactDate = React.useCallback((date: string | null) => {
    if (!date) {
      return "Unknown date";
    }

    return format(new Date(date), "dd/MM/yyyy 'at' HH:mm");
  }, []);

  const visibleMeetings = React.useMemo(
    () => meetings.filter((meeting) => meeting.is_showable_in_ui),
    [meetings]
  );

  const meetingRows = React.useMemo<MeetingRow[]>(
    () =>
      visibleMeetings.map((meeting) => {
        const createdTimestamp = meeting.created_datetime
          ? new Date(meeting.created_datetime).getTime()
          : 0;

        return {
          id: meeting.id,
          title: meeting.title?.trim() || DEFAULT_MEETING_TITLE,
          createdDatetime: meeting.created_datetime,
          createdLabel: formatReadableDate(meeting.created_datetime),
          createdExactLabel: formatExactDate(meeting.created_datetime),
          createdTimestamp: Number.isFinite(createdTimestamp)
            ? createdTimestamp
            : 0,
          hearingTypes: extractHearingTypes(meeting.tags),
          isDone: isDoneMeeting(meeting.tags),
          documentBlobPath: meeting.document_blob_path ?? null,
          source: meeting,
        };
      }),
    [visibleMeetings, formatExactDate, formatReadableDate]
  );

  const extractAppellantNameFromTitle = React.useCallback((title: string) => {
    const [appellantName] = title.split(/\s+v\s+/i);
    return appellantName?.trim() || null;
  }, []);

  const handleOpenMeeting = React.useCallback(
    async (meeting: MeetingRow) => {
      track("opened_existing_transcript", {
        transcriptId: meeting.id,
      });

      setMeetingToPreview(meeting);
      setPreviewTranscript(EMPTY_SECTIONED_TRANSCRIPT);
      setPreviewAppellantName(extractAppellantNameFromTitle(meeting.title));
      setIsPreviewLoading(true);

      try {
        const sectionedTranscriptResponse = await apiClient.request<
          SectionedTranscript | TranscriptViewerResponse
        >(`/transcriptions/${meeting.id}/sectioned-transcript`);

        if (sectionedTranscriptResponse.data) {
          if ("messages" in sectionedTranscriptResponse.data) {
            setPreviewTranscript(sectionedTranscriptResponse.data.messages);
            setPreviewAppellantName(
              sectionedTranscriptResponse.data.appellantName ??
                extractAppellantNameFromTitle(meeting.title)
            );
          } else {
            setPreviewTranscript(sectionedTranscriptResponse.data);
          }
          return;
        }

        const jobs = await getTranscriptionJobs(meeting.id);
        const latestJob = [...jobs]
          .filter((job) => job.dialogue_entries.length > 0)
          .sort((a, b) => {
            const aTime = a.created_datetime
              ? new Date(a.created_datetime).getTime()
              : 0;
            const bTime = b.created_datetime
              ? new Date(b.created_datetime).getTime()
              : 0;
            return bTime - aTime;
          })[0];

        setPreviewTranscript(
          buildFallbackTranscript(latestJob?.dialogue_entries ?? [])
        );
      } catch (error) {
        console.error("Error loading saved transcript:", error);
        toast.error("Failed to load saved transcript");
        setPreviewTranscript(EMPTY_SECTIONED_TRANSCRIPT);
        setPreviewAppellantName(extractAppellantNameFromTitle(meeting.title));
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [extractAppellantNameFromTitle]
  );

  const deleteMeetings = React.useCallback(
    async (meetingsToDelete: MeetingRow[]) => {
      for (const meeting of meetingsToDelete) {
        track("deleted_transcript", {
          transcriptId: meeting.id,
        });
        await Promise.resolve(deleteTranscription(meeting.id));
      }
    },
    [deleteTranscription]
  );

  const handleBulkDelete = React.useCallback(
    async (meetingsToDelete: MeetingRow[]) => {
      if (meetingsToDelete.length === 0) return;

      setIsBulkDeleting(true);

      try {
        await deleteMeetings(meetingsToDelete);
        toast.success(`Deleted ${meetingsToDelete.length} recording(s)`);
      } catch (error) {
        console.error("Error deleting transcripts:", error);
        toast.error("Failed to delete selected recordings");
      } finally {
        setIsBulkDeleting(false);
      }
    },
    [deleteMeetings]
  );

  const handleConfirmSingleDelete = React.useCallback(async () => {
    if (!meetingToDelete) return;

    setIsDeletingMeeting(true);
    try {
      await deleteMeetings([meetingToDelete]);
      toast.success("Recording deleted");
      setMeetingToDelete(null);
    } catch (error) {
      console.error("Error deleting transcript:", error);
      toast.error("Failed to delete recording");
    } finally {
      setIsDeletingMeeting(false);
    }
  }, [meetingToDelete, deleteMeetings]);

  const handleDownloadDocument = React.useCallback(
    async (meeting: MeetingRow) => {
      try {
        await downloadTranscriptDocument(meeting.id);
      } catch (error) {
        console.error("Error downloading document:", error);
        toast.error("Failed to download document");
      }
    },
    []
  );

  const handleStartRename = React.useCallback((meeting: MeetingRow) => {
    setMeetingToRename(meeting);
    setRenameTitle(meeting.source.title || "");
  }, []);

  const handleConfirmRename = React.useCallback(async () => {
    if (!meetingToRename) return;

    const nextTitle = renameTitle.trim();
    if (!nextTitle) {
      toast.error("Please provide a title");
      return;
    }

    setIsRenamingMeeting(true);
    try {
      track("renamed_transcript", {
        transcriptId: meetingToRename.id,
      });
      await renameTranscription(meetingToRename.id, nextTitle);
      toast.success("Recording renamed");
      setMeetingToRename(null);
    } catch (error) {
      console.error("Error renaming transcript:", error);
      toast.error("Failed to rename recording");
    } finally {
      setIsRenamingMeeting(false);
    }
  }, [meetingToRename, renameTitle, renameTranscription]);

  const updateDoneStatus = React.useCallback(
    async (meetingsToUpdate: MeetingRow[], shouldBeDone: boolean) => {
      const targets = meetingsToUpdate.filter(
        (meeting) => meeting.isDone !== shouldBeDone
      );
      if (targets.length === 0) {
        toast.message(
          shouldBeDone
            ? "Selected recordings are already marked as done."
            : "Selected recordings are already marked as not done."
        );
        return;
      }

      setIsUpdatingDoneState(true);
      try {
        for (const meeting of targets) {
          if (shouldBeDone) {
            await addTagToTranscription(meeting.id, DONE_MEETING_TAG);
            track("marked_transcript_done", {
              transcriptId: meeting.id,
            });
          } else {
            await removeTagFromTranscription(meeting.id, DONE_MEETING_TAG);
            track("unmarked_transcript_done", {
              transcriptId: meeting.id,
            });
          }
        }

        await refreshMetadata();
        toast.success(
          shouldBeDone
            ? `Marked ${targets.length} recording(s) as done`
            : `Marked ${targets.length} recording(s) as not done`
        );
      } catch (error) {
        console.error("Error updating recording status:", error);
        toast.error("Failed to update recording status");
        await refreshMetadata();
      } finally {
        setIsUpdatingDoneState(false);
      }
    },
    [refreshMetadata]
  );

  const handleToggleDone = React.useCallback(
    async (meeting: MeetingRow) => {
      await updateDoneStatus([meeting], !meeting.isDone);
    },
    [updateDoneStatus]
  );

  const handleBulkMarkDone = React.useCallback(
    async (meetingsToUpdate: MeetingRow[]) => {
      await updateDoneStatus(meetingsToUpdate, true);
    },
    [updateDoneStatus]
  );

  return (
    <>
      <TranscriptSheet
        meeting={meetingToPreview}
        transcript={previewTranscript}
        appellantName={previewAppellantName}
        isLoading={isPreviewLoading}
        open={Boolean(meetingToPreview)}
        onOpenChange={(open) => {
          if (!open) {
            setMeetingToPreview(null);
            setPreviewTranscript(EMPTY_SECTIONED_TRANSCRIPT);
            setPreviewAppellantName(null);
            setIsPreviewLoading(false);
          }
        }}
      />

      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-foreground">
          Recent recordings
        </h2>
      </div>

      {isLoading && (
        <div className="py-8 text-center text-muted-foreground">
          Loading your meetings...
        </div>
      )}

      {!isLoading && meetingRows.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          You don&apos;t have any recordings yet. Start by creating a new one!
        </div>
      )}

      {!isLoading && meetingRows.length > 0 && (
        <MeetingsDataTable
          data={meetingRows}
          onOpenMeeting={handleOpenMeeting}
          onRenameMeeting={handleStartRename}
          onDeleteMeeting={setMeetingToDelete}
          onDownloadDocument={handleDownloadDocument}
          onToggleDone={handleToggleDone}
          onBulkDelete={handleBulkDelete}
          onBulkMarkDone={handleBulkMarkDone}
          isBulkDeleting={isBulkDeleting}
          isBulkMarkingDone={isUpdatingDoneState}
        />
      )}

      <AlertDialog
        open={Boolean(meetingToDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeletingMeeting) {
            setMeetingToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recording?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {meetingToDelete?.title ?? "this recording"}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingMeeting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingMeeting}
              onClick={() => void handleConfirmSingleDelete()}
            >
              {isDeletingMeeting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(meetingToRename)}
        onOpenChange={(open) => {
          if (!open && !isRenamingMeeting) {
            setMeetingToRename(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename recording</DialogTitle>
            <DialogDescription>
              Update the title shown in the hearings list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="meeting-rename"
              className="text-sm font-medium text-foreground"
            >
              Title
            </label>
            <Input
              id="meeting-rename"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              placeholder="Enter a recording title"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleConfirmRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMeetingToRename(null)}
              disabled={isRenamingMeeting}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirmRename()}
              disabled={isRenamingMeeting}
            >
              {isRenamingMeeting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default MeetingsList;
