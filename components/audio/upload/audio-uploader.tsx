"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import ErrorReportCard from "@/components/ui/error-report-card";
import { useTranscripts } from "@/providers/transcripts";
import ContentDisplay from "./content-display";
import type { AudioUploaderProps } from "./types";
import useAudioUpload from "./use-audio-upload";

function AudioUploader({ initialRecordingMode, onClose }: AudioUploaderProps) {
  const { setIsProcessingTranscription } = useTranscripts();

  const {
    audioBlob,
    processingStatus,
    setProcessingStatus,
    uploadError,
    errorDetails,
    currentBackupId,
    isUploadUrlReady,
    startTranscription,
    handleRecordingStart,
    handleRecordingStop,
  } = useAudioUpload({
    initialRecordingMode,
    setIsProcessingTranscription,
  });

  return (
    <div className="mx-auto mt-8 pt-2 w-full max-w-3xl">
      <ContentDisplay
        processingStatus={processingStatus}
        setProcessingStatus={setProcessingStatus}
        uploadError={uploadError}
        audioBlob={audioBlob}
        startTranscription={startTranscription}
        initialRecordingMode={initialRecordingMode}
        isUploadUrlReady={isUploadUrlReady}
        onRecordingStart={handleRecordingStart}
        onRecordingStop={handleRecordingStop}
        onClose={onClose}
      />

      {uploadError && (
        <>
          <Alert
            variant="destructive"
            className="my-4 w-full border border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
          >
            <AlertDescription className="flex items-center gap-2">
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {uploadError}{" "}
              {errorDetails.requestId ? `(req ${errorDetails.requestId})` : ""}
            </AlertDescription>
          </Alert>
          <ErrorReportCard
            data={{
              title: "Audio upload/transcription failure",
              requestId: errorDetails.requestId,
              statusCode: errorDetails.statusCode,
              recordingMode: initialRecordingMode,
              fileSizeBytes: audioBlob?.size ?? null,
              durationSeconds: errorDetails.duration,
              errorMessage: uploadError,
              extra: {
                user_upload_key: errorDetails.userUploadKey,
                backup_id: currentBackupId,
              },
              sentryEventId: errorDetails.sentryEventId,
            }}
          />
        </>
      )}
    </div>
  );
}

export default AudioUploader;
