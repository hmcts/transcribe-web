"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Button } from "@/components/recording/ui/button";
import { describeRecordingLimit } from "@/lib/flags/runtime-flags";
import { isHearingDate, todayInLondon } from "@/lib/recording/hearing-date";
import { audioTooLargeError } from "@/lib/recording/upload-limits";
import { useMaxUploadBytes } from "@/lib/recording/use-max-upload-bytes";
import { cn } from "@/lib/recording/utils";
import { useMaxRecordingSeconds } from "@/providers/runtime-flags";

interface AudioUploadProps {
  // hearingDate is given only when askHearingDate is set.
  onUpload: (file: File, hearingDate?: string) => void;
  uploading?: boolean;
  // DIAAT-428: ask for the date of the hearing day the recording is of
  // (today unless changed).
  askHearingDate?: boolean;
  submitLabel?: string;
}

const ACCEPTED_TYPES = {
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/mp4": [".mp4", ".m4a"],
  "audio/ogg": [".ogg"],
  "audio/flac": [".flac"],
};

export function AudioUpload({
  onUpload,
  uploading = false,
  askHearingDate = false,
  submitLabel = "Transcribe a recording",
}: AudioUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [hearingDate, setHearingDate] = useState(todayInLondon);
  const maxRecording = describeRecordingLimit(useMaxRecordingSeconds());
  const maxUploadBytes = useMaxUploadBytes();

  // A file over the size limit is refused here, before any of it is sent: the
  // browser keeps sending after the server has answered 413, so the user would
  // otherwise wait for the whole upload (minutes for a gigabyte) to be told.
  const tooLarge = useCallback(
    (file: File) => {
      if (maxUploadBytes === null || file.size <= maxUploadBytes) return false;
      toast.error(audioTooLargeError(maxUploadBytes));
      return true;
    },
    [maxUploadBytes]
  );

  const onDrop = useCallback(
    (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      if (tooLarge(file)) {
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
    },
    [tooLarge]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    disabled: uploading,
    onDropRejected: () =>
      toast.error("Unsupported file type. Please upload an audio file."),
  });

  const handleSubmit = () => {
    if (!selectedFile) {
      toast.error("Please select a file first.");
      return;
    }
    // The limit may only have been read after the file was chosen.
    if (tooLarge(selectedFile)) {
      setSelectedFile(null);
      return;
    }
    if (!askHearingDate) {
      onUpload(selectedFile);
      return;
    }
    if (!isHearingDate(hearingDate)) {
      toast.error("Enter the date of the hearing.");
      return;
    }
    onUpload(selectedFile, hearingDate);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
          uploading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input {...getInputProps()} aria-label="Audio file input" />
        <Upload className="mx-auto size-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">
          {isDragActive
            ? "Drop the audio file here"
            : "Drag and drop an audio file, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          MP3, WAV, MP4, M4A, OGG, FLAC supported
        </p>
        {/* DIAAT-408: the longest recording is the API's, read from GET /api/flags (4 hours until it says otherwise). */}
        <p className="text-xs text-muted-foreground mt-1">
          Recordings up to {maxRecording}. For long recordings, MP3 or M4A files
          are much smaller than WAV.
        </p>
        {selectedFile && (
          <p className="text-sm text-primary mt-3 font-medium">
            Selected: {selectedFile.name}
          </p>
        )}
      </div>

      {askHearingDate && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Date of the hearing
          <input
            type="date"
            value={hearingDate}
            onChange={(e) => setHearingDate(e.target.value)}
            disabled={uploading}
            className="w-48 rounded-md border border-border px-3 py-1.5 font-normal focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      )}

      <Button
        onClick={handleSubmit}
        disabled={!selectedFile || uploading}
        className="w-full"
      >
        {uploading ? "Uploading…" : submitLabel}
      </Button>
    </div>
  );
}
