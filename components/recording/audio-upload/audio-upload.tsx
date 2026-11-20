"use client";

import { Upload } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Button } from "@/components/recording/ui/button";
import { describeRecordingLimit } from "@/lib/flags/runtime-flags";
import { cn } from "@/lib/recording/utils";
import { useMaxRecordingSeconds } from "@/providers/runtime-flags";

interface AudioUploadProps {
  onUpload: (file: File) => void;
  uploading?: boolean;
}

const ACCEPTED_TYPES = {
  "audio/mpeg": [".mp3"],
  "audio/wav": [".wav"],
  "audio/mp4": [".mp4", ".m4a"],
  "audio/ogg": [".ogg"],
  "audio/flac": [".flac"],
};

export function AudioUpload({ onUpload, uploading = false }: AudioUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const maxRecording = describeRecordingLimit(useMaxRecordingSeconds());

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setSelectedFile(accepted[0]);
  }, []);

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
    onUpload(selectedFile);
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

      <Button
        onClick={handleSubmit}
        disabled={!selectedFile || uploading}
        className="w-full"
      >
        {uploading ? "Uploading…" : "Transcribe a recording"}
      </Button>
    </div>
  );
}
