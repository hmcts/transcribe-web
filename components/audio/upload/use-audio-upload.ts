"use client";

import * as Sentry from "@sentry/nextjs";
import { useCallback, useEffect, useState } from "react";
import type { AudioProcessingStatus } from "@/components/audio/processing/processing-loader";
import { track } from "@/lib/analytics";
import { apiClient } from "@/lib/api-client";
import { audioBackupDB } from "@/lib/indexeddb-backup";
import type { UploadErrorDetails, UploadUrlData } from "./types";
import {
  detectSupportedMimeType,
  getExtensionFromMimeType,
} from "./upload-utils";

interface UseAudioUploadOptions {
  initialRecordingMode: "mic" | "screen" | "upload";
  setIsProcessingTranscription: (isProcessing: boolean) => void;
}

export default function useAudioUpload({
  initialRecordingMode,
  setIsProcessingTranscription,
}: UseAudioUploadOptions) {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [processingStatus, setProcessingStatus] =
    useState<AudioProcessingStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentBackupId, setCurrentBackupId] = useState<string | null>(null);
  const [currentBlobPath, setCurrentBlobPath] = useState<string | null>(null);
  const [uploadUrlData, setUploadUrlData] = useState<UploadUrlData | null>(
    null
  );
  const [isUploadUrlReady, setIsUploadUrlReady] = useState<boolean>(false);
  const [errorDetails, setErrorDetails] = useState<UploadErrorDetails>({
    requestId: null,
    statusCode: null,
    sentryEventId: null,
    userUploadKey: null,
    duration: null,
  });

  // Helper: Clean up backup after successful upload
  const cleanupBackup = useCallback(
    async (backupIdToDelete?: string | null) => {
      const idToDelete = backupIdToDelete || currentBackupId;
      if (!idToDelete) return;

      try {
        await audioBackupDB.deleteAudioBackup(idToDelete);
        setCurrentBackupId(null);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error deleting backup:", error);
        // Don't alert user about backup deletion failure
      }
    },
    [currentBackupId]
  );

  // Helper: Report error to Sentry with full context
  const reportError = useCallback(
    (error: Error, blob: Blob) => {
      const errorWithMetadata = error as Error & {
        requestId?: string;
        status?: number;
      };

      const eventId = Sentry.captureException(error, {
        tags: {
          area: "audio-upload",
          recording_mode: initialRecordingMode,
        },
        extra: {
          request_id: errorWithMetadata.requestId || null,
          status_code: errorWithMetadata.status || null,
          user_upload_key: errorDetails.userUploadKey,
          backup_id: currentBackupId,
          blob_type: blob.type,
          blob_size: blob.size,
        },
      });

      setErrorDetails({
        requestId: errorWithMetadata.requestId || null,
        statusCode: errorWithMetadata.status || null,
        sentryEventId: eventId || null,
        userUploadKey: errorDetails.userUploadKey,
        duration: errorDetails.duration,
      });
    },
    [initialRecordingMode, currentBackupId, errorDetails]
  );

  // Helper: Fetch upload URL from backend and store it
  const fetchUploadUrl = useCallback(async (): Promise<boolean> => {
    const maxRetries = 3;
    const retryDelay = 1000;

    /* eslint-disable no-await-in-loop */
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const mimeType = detectSupportedMimeType();
        const fileExtension = getExtensionFromMimeType(mimeType);

        const urlResult = await apiClient.getUploadUrl(fileExtension);

        if (urlResult.error) {
          // eslint-disable-next-line no-console
          console.error(
            `Failed to fetch upload URL (attempt ${attempt}/${maxRetries}):`,
            urlResult.error
          );
          if (attempt < maxRetries) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, retryDelay);
            });
            // eslint-disable-next-line no-continue
            continue;
          }
          return false;
        }

        if (urlResult.data) {
          setUploadUrlData(urlResult.data);
          setErrorDetails((prev) => ({
            ...prev,
            userUploadKey: urlResult.data?.user_upload_s3_file_key ?? null,
          }));
          return true;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `Error fetching upload URL (attempt ${attempt}/${maxRetries}):`,
          error
        );
        if (attempt < maxRetries) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, retryDelay);
          });
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return false;
  }, []);

  // Fetch upload URL when component mounts
  useEffect(() => {
    const initializeUploadUrl = async () => {
      setIsUploadUrlReady(false);
      const success = await fetchUploadUrl();
      setIsUploadUrlReady(success);

      if (!success) {
        setUploadUrlData(null);
        setUploadError(
          "Failed to initialize upload. Please refresh the page or check your connection."
        );
        Sentry.captureMessage("Failed to pre-fetch upload URL after retries", {
          level: "error",
          tags: { area: "audio-upload-init" },
        });
      }
    };

    initializeUploadUrl();
  }, [fetchUploadUrl]);

  // Helper: Upload file to the configured upload URL
  const uploadFile = useCallback(
    async (blob: Blob, uploadUrl: string): Promise<void> => {
      const authToken = await apiClient.getToken();

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            setProcessingStatus({ state: "uploading", progress });
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Upload failed with status ${xhr.status}: ${xhr.statusText}`
              )
            );
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Network error during upload"));
        });

        xhr.addEventListener("timeout", () => {
          reject(new Error("Upload timed out"));
        });

        xhr.open("PUT", uploadUrl);
        if (authToken)
          xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
        xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
        xhr.timeout = 300000; // 5 minute timeout
        xhr.send(blob);
      });
    },
    []
  );

  // Helper: Single upload attempt using direct blob storage upload with SAS URL
  const attemptUpload = useCallback(
    async (blob: Blob, attemptNumber: number) => {
      // Show retry message if needed
      if (attemptNumber > 1) {
        setUploadError(`Retrying upload (attempt ${attemptNumber} of 2)...`);
      }

      // Upload URL should always be available due to pre-fetch with retry logic
      if (!uploadUrlData) {
        const errorMsg = "Upload URL not available. This should not happen.";
        // eslint-disable-next-line no-console
        console.error(errorMsg);
        Sentry.captureMessage(errorMsg, {
          level: "error",
          tags: { area: "audio-upload" },
        });
        throw new Error(errorMsg);
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { upload_url, user_upload_s3_file_key } = uploadUrlData;

      // Store blob path for error reporting
      setCurrentBlobPath(user_upload_s3_file_key);
      setErrorDetails((prev) => ({
        ...prev,
        userUploadKey: user_upload_s3_file_key,
      }));

      // Upload directly to blob storage using SAS URL
      setProcessingStatus({ state: "uploading", progress: 0 });
      await uploadFile(blob, upload_url);

      // Clear retry message after successful upload
      if (attemptNumber > 1) {
        setUploadError(null);
      }

      // Track success
      setProcessingStatus("transcribing");
      track("transcription_started", {
        file_type: blob.type,
        source: blob instanceof File ? "upload" : "recording",
        retry_attempt: attemptNumber,
        blob_path: user_upload_s3_file_key,
      });
    },
    [uploadUrlData, uploadFile]
  );

  const startTranscription = useCallback(
    async (blob: Blob, backupIdToDelete?: string | null) => {
      const MAX_RETRIES = 2;
      let lastError: Error | null = null;

      // Try upload with retries
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          setUploadError(null);
          // eslint-disable-next-line no-await-in-loop
          await attemptUpload(blob, attempt);

          // Success! Clean up backup
          // eslint-disable-next-line no-await-in-loop
          await cleanupBackup(backupIdToDelete);

          // Fetch new upload URL for next upload (SAS URLs are single-use)
          setIsUploadUrlReady(false);
          // eslint-disable-next-line no-await-in-loop
          const newUrlSuccess = await fetchUploadUrl();
          setIsUploadUrlReady(newUrlSuccess);

          // Clear stale URL data if fetch failed
          if (!newUrlSuccess) {
            setUploadUrlData(null);
          }

          return; // Exit on success
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error("Unknown error");
          // eslint-disable-next-line no-console
          console.error(`Upload attempt ${attempt} failed:`, lastError.message);

          // Wait before retry (except on last attempt)
          if (attempt < MAX_RETRIES) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => {
              setTimeout(resolve, 1000);
            });
          }
        }
      }

      // All retries failed - report error
      setUploadError(lastError?.message || "Error occurred while transcribing");
      try {
        reportError(lastError || new Error("Unknown error"), blob);
      } catch (reportingError) {
        // eslint-disable-next-line no-console
        console.error("Error capturing sentry event:", reportingError);
      }
      setIsProcessingTranscription(false);
      setProcessingStatus("idle");
    },
    [
      attemptUpload,
      cleanupBackup,
      reportError,
      setIsProcessingTranscription,
      fetchUploadUrl,
    ]
  );

  const handleRecordingStart = useCallback(() => {
    setProcessingStatus("recording");
  }, []);

  const handleRecordingStop = useCallback(
    (blob: Blob | null, backupId?: string | null) => {
      if (blob) {
        setAudioBlob(blob);
        if (backupId) {
          setCurrentBackupId(backupId);
        }
        setProcessingStatus({ state: "uploading", progress: 0 });
        // Pass backupId directly to ensure it gets deleted after successful upload
        startTranscription(blob, backupId);
      } else {
        // Recording failed to produce a blob - reset to idle
        setProcessingStatus("idle");
      }
    },
    [startTranscription]
  );

  return {
    audioBlob,
    processingStatus,
    setProcessingStatus,
    uploadError,
    errorDetails,
    currentBackupId,
    currentBlobPath,
    isUploadUrlReady,
    startTranscription,
    handleRecordingStart,
    handleRecordingStop,
  };
}
