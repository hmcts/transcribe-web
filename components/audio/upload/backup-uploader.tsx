"use client";

import { useCallback, useState } from "react";
import ProcessingLoader, {
  type AudioProcessingStatus,
} from "@/components/audio/processing/processing-loader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api-client";
import { type AudioBackup, audioBackupDB } from "@/lib/indexeddb-backup";
import { useTranscripts } from "@/providers/transcripts";

interface BackupUploaderProps {
  backup: AudioBackup;
  onClose: () => void;
  onUploadSuccess: () => void;
}

function BackupUploader({
  backup,
  onClose,
  onUploadSuccess,
}: BackupUploaderProps) {
  const [processingStatus, setProcessingStatus] =
    useState<AudioProcessingStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { setIsProcessingTranscription } = useTranscripts();

  const startTranscription = useCallback(
    async (blob: Blob) => {
      try {
        const fileExtension = blob.type.includes("mp4") ? "mp4" : "webm";
        setProcessingStatus({ state: "uploading", progress: 0 });
        setUploadError(null);

        const urlResult = await apiClient.getUploadUrl(fileExtension);

        if (urlResult.error || !urlResult.data) {
          throw new Error("Failed to get upload URL");
        }

        const { upload_url } = urlResult.data;

        const authToken = await apiClient.getToken();

        // Create XMLHttpRequest to track upload progress
        const xhr = new XMLHttpRequest();
        await new Promise((resolve, reject) => {
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              const progress = Math.round((event.loaded / event.total) * 100);
              setProcessingStatus({ state: "uploading", progress });
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(xhr.response);
            } else {
              reject(new Error("Failed to upload file to Azure Storage"));
            }
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Network error during upload"));
          });

          xhr.addEventListener("timeout", () => {
            reject(new Error("Upload timed out"));
          });

          xhr.open("PUT", upload_url);
          if (authToken)
            xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
          xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
          xhr.send(blob);
        });

        setProcessingStatus("transcribing");

        track("transcription_started", {
          file_type: blob.type,
          source: "backup_retry",
        });

        // Clean up backup after successful upload
        try {
          await audioBackupDB.deleteAudioBackup(backup.id);
          if (onUploadSuccess) {
            onUploadSuccess();
          }
        } catch (error) {
          // Sentry.captureException(error);
          console.error(`error deleting backup: ${error}`);
        }
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : "Error occurred while transcribing"
        );
        setIsProcessingTranscription(false);
        setProcessingStatus("idle");
      }
    },
    [setIsProcessingTranscription, backup.id, onUploadSuccess]
  );

  const handleRetryUpload = () => {
    startTranscription(backup.blob);
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "Unknown duration";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleReturnHome = () => {
    onClose();
  };

  return (
    <div className="mx-auto mt-8 w-full max-w-3xl">
      <div className="space-y-6 py-8">
        {processingStatus !== "idle" ? (
          <ProcessingLoader
            status={processingStatus}
            onStopPolling={() => setProcessingStatus("idle")}
          />
        ) : (
          <div className="space-y-6">
            {/* Orange Retry Icon */}
            <div className="flex justify-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-[#FF9500] md:size-20">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="md:scale-125"
                  role="img"
                  aria-label="Retry upload"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </div>
            </div>

            <div className="text-center">
              {/* Title */}
              <h1 className="mb-2 text-2xl font-semibold text-black dark:text-white md:text-3xl">
                Retry the upload
              </h1>

              {/* Subtitle */}
              <p className="mb-4 text-base text-gray-600 dark:text-gray-400 md:text-xl">
                We saved your recording. Re-upload to complete.
              </p>

              {/* File Details */}
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400 md:text-base">
                <p>
                  <span role="img" aria-label="File">
                    📄
                  </span>{" "}
                  {backup.fileName}
                </p>
                <p>
                  <span role="img" aria-label="Clock">
                    🕐
                  </span>{" "}
                  Recorded: {formatTimestamp(backup.timestamp)}
                </p>
                <p>
                  <span role="img" aria-label="Timer">
                    ⏱️
                  </span>{" "}
                  Duration: {formatDuration(backup.recordingDuration)}
                </p>
              </div>
            </div>

            {/* Buttons - Responsive Layout */}
            <div className="flex flex-row items-center justify-center gap-3">
              <Button
                onClick={handleReturnHome}
                variant="outline"
                className="min-h-[44px] w-auto px-6 py-2 font-medium shadow-sm transition-all duration-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-safe:hover:scale-105 motion-safe:active:scale-95 md:text-lg"
              >
                Return to Home
              </Button>
              <Button
                onClick={handleRetryUpload}
                className="min-h-[44px] w-auto bg-blue-700 px-6 py-2 text-[#E8E8E8] shadow-md transition-all duration-200 hover:bg-blue-800 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 motion-safe:hover:scale-105 motion-safe:active:scale-95 md:text-lg"
              >
                Retry Upload
              </Button>
            </div>
          </div>
        )}

        {uploadError && (
          <Alert
            variant="destructive"
            className="border border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
            role="alert"
          >
            <AlertDescription className="flex items-center gap-2">
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                role="img"
                aria-label="Error"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {uploadError}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

export default BackupUploader;
