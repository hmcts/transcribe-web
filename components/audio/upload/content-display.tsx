/* eslint-disable no-nested-ternary */

"use client";

import { RefreshCw, Trash } from "lucide-react";
import { useState } from "react";
import ProcessingLoader from "@/components/audio/processing/processing-loader";
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
import AudioRecorderComponent from "../recording/audio-recorder";
import ScreenRecorder from "../recording/screen-recorder";
import FileUploadForm from "./file-upload-form";
import type { ContentDisplayProps } from "./types";

export default function ContentDisplay({
  processingStatus,
  setProcessingStatus,
  uploadError,
  audioBlob,
  startTranscription,
  initialRecordingMode,
  isUploadUrlReady,
  onRecordingStop,
  onRecordingStart,
  onClose,
}: ContentDisplayProps) {
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [recordingStarted, setRecordingStarted] = useState(false);

  const handleClose = () => {
    if (!audioBlob && processingStatus === "idle") {
      onClose();
    } else if (processingStatus !== "transcribing") {
      setShowCloseDialog(true);
    } else {
      onClose();
    }
  };

  const handleRecordingStart = () => {
    setRecordingStarted(true);
    onRecordingStart();
  };

  // Only show Close button after recording has started
  const showCloseButton =
    recordingStarted || audioBlob || processingStatus !== "idle";

  return (
    <div
      className={
        initialRecordingMode === "mic" ? "md:origin-top md:scale-125" : ""
      }
    >
      {showCloseButton && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClose}
            className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <Trash className="size-4" aria-hidden="true" />
            Discard
          </Button>
        </div>
      )}

      {processingStatus !== "idle" && processingStatus !== "recording" ? (
        <ProcessingLoader
          status={processingStatus}
          onStopPolling={() => setProcessingStatus("idle")}
        />
      ) : uploadError && audioBlob ? (
        <div className="mt-8">
          <div className="mb-4 text-center">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
              Error Processing Audio
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Please check your internet connection and try again
            </p>
          </div>
          <div className="flex justify-center gap-4">
            <Button
              variant="default"
              onClick={() => {
                startTranscription(audioBlob, null);
              }}
              disabled={!audioBlob}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              Retry transcription
            </Button>
          </div>
        </div>
      ) : (
        <div className="">
          {initialRecordingMode === "mic" && (
            <AudioRecorderComponent
              onRecordingStart={handleRecordingStart}
              onRecordingStop={onRecordingStop}
              disabled={!isUploadUrlReady}
            />
          )}

          {initialRecordingMode === "screen" && (
            <ScreenRecorder
              onRecordingStop={onRecordingStop}
              onRecordingStart={handleRecordingStart}
              disabled={!isUploadUrlReady}
            />
          )}

          {initialRecordingMode === "upload" && (
            <FileUploadForm
              disabled={!isUploadUrlReady}
              onFileSelected={(file) => onRecordingStop(file)}
            />
          )}
        </div>
      )}

      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Recorder?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard the recording?
              <br />
              YOU WILL NOT BE ABLE TO RESUME RECORDING.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="h-12 w-full sm:h-10 sm:w-auto">
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onClose}
              className="h-12 w-full bg-red-600 text-white hover:bg-red-700 dark:bg-red-900 dark:hover:bg-red-800 sm:h-10 sm:w-auto"
            >
              Close and STOP recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
