import type { AudioProcessingStatus } from "@/components/audio/processing/processing-loader";

export interface ContentDisplayProps {
  processingStatus: AudioProcessingStatus;
  setProcessingStatus: (status: AudioProcessingStatus) => void;
  uploadError: string | null;
  audioBlob: Blob | null;
  startTranscription: (blob: Blob, backupIdToDelete?: string | null) => void;
  initialRecordingMode: "mic" | "screen" | "upload";
  isUploadUrlReady: boolean;
  onRecordingStop: (blob: Blob | null, backupId?: string | null) => void;
  onRecordingStart: () => void;
  onClose: () => void;
}

export interface AudioUploaderProps {
  initialRecordingMode: "mic" | "screen" | "upload";
  onClose: () => void;
}

export interface UploadErrorDetails {
  requestId: string | null;
  statusCode: number | null;
  sentryEventId: string | null;
  userUploadKey: string | null;
  duration: number | null;
}

export interface UploadUrlData {
  upload_url: string;
  user_upload_s3_file_key: string;
}
