import { apiClient } from "@/lib/api-client";

export interface UploadUrlData {
  upload_url: string;
  user_upload_s3_file_key: string;
}

export interface FetchUploadUrlResult {
  success: boolean;
  data?: UploadUrlData;
}

/**
 * Detect the supported MIME type for recording
 */
export function detectSupportedMimeType(): string {
  const mimeTypes = [
    "video/mp4", // iOS primary format
    "audio/mp4", // Desktop MP4 format
    "audio/webm", // WebM fallback
  ];

  const supportedMimeType = mimeTypes.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType)
  );

  // Default fallback
  return supportedMimeType || "audio/webm";
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExtension: Record<string, string> = {
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/ogg": "ogg",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "aac",
    "video/quicktime": "mov",
    "video/mpeg": "mp4",
  };

  return mimeToExtension[mimeType.toLowerCase()] || "webm";
}

/**
 * Fetch a time-limited SAS URL from the API for direct client upload to blob storage.
 * The backend generates the URL using managed identity (no secrets exposed).
 */
export async function fetchUploadUrl(): Promise<FetchUploadUrlResult> {
  const maxRetries = 3;
  const retryDelay = 1000;

  /* eslint-disable no-await-in-loop */
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const mimeType = detectSupportedMimeType();
      const fileExtension = mimeType.includes("mp4") ? "mp4" : "webm";

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
        return { success: false };
      }

      if (urlResult.data) {
        return { success: true, data: urlResult.data };
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

  return { success: false };
}
