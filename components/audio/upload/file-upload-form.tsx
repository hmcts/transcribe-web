"use client";

import { AlertCircle, FileAudio, UploadCloud } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";

interface FileUploadFormProps {
  disabled: boolean;
  onFileSelected: (file: File) => void;
}

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB safety limit
const ACCEPTED_MIME_PREFIXES = ["audio/", "video/"];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const formatted = bytes / 1024 ** i;
  return `${formatted.toFixed(formatted > 10 ? 0 : 1)} ${units[i]}`;
}

export default function FileUploadForm({
  disabled,
  onFileSelected,
}: FileUploadFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const validateFile = useCallback((file: File) => {
    const isMimeSupported = ACCEPTED_MIME_PREFIXES.some((prefix) =>
      file.type.startsWith(prefix)
    );

    if (!isMimeSupported) {
      track("file_upload_validation_failed", {
        reason: "unsupported_mime_type",
        file_type: file.type || "unknown",
        file_size_bytes: file.size,
      });
      setLocalError("Please upload an audio or video file.");
      setSelectedFile(null);
      return false;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      track("file_upload_validation_failed", {
        reason: "file_too_large",
        file_type: file.type || "unknown",
        file_size_bytes: file.size,
      });
      setLocalError("File is too large. Please keep uploads under 2 GB.");
      setSelectedFile(null);
      return false;
    }

    track("file_upload_selected", {
      file_type: file.type || "unknown",
      file_size_bytes: file.size,
    });
    setLocalError(null);
    setSelectedFile(file);
    return true;
  }, []);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length || disabled) {
        return;
      }
      validateFile(files[0]);
    },
    [disabled, validateFile]
  );

  const handleBrowseClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const handleUpload = () => {
    if (!selectedFile || disabled) return;
    onFileSelected(selectedFile);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleFiles(event.dataTransfer?.files || null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,video/mp4,video/webm,video/mpeg,video/quicktime"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />

      <div
        className="rounded-3xl border-2 border-dashed border-blue-200 bg-white p-8 text-center shadow-sm transition hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900/40"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
          <UploadCloud className="size-8" aria-hidden="true" />
        </div>
        <h2 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Upload an existing recording
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Drag and drop an audio/video file or browse your device. We&apos;ll
          transcribe it using the same secure pipeline as live recordings.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full sm:w-auto"
            onClick={handleBrowseClick}
            disabled={disabled}
          >
            <UploadCloud className="mr-2 size-4" aria-hidden="true" />
            Choose file
          </Button>
          {selectedFile && (
            <Button
              type="button"
              className="h-12 w-full sm:w-auto"
              onClick={handleUpload}
              disabled={disabled}
            >
              Upload &amp; transcribe
            </Button>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-gray-50 p-4 text-left text-sm text-gray-600 dark:bg-slate-900/60 dark:text-gray-300">
          <p className="font-medium">Supported formats</p>
          <p>MP4, WebM, WAV, MP3, M4A, and most common audio/video files.</p>
          <p className="mt-2 text-xs text-gray-500">
            Tip: For best results upload files under 2 hours in length.
          </p>
        </div>
      </div>

      {selectedFile && (
        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-blue-50 p-2 dark:bg-blue-500/10">
              <FileAudio className="size-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {selectedFile.name}
              </p>
              <p className="text-xs text-gray-500">
                {formatBytes(selectedFile.size)} •{" "}
                {selectedFile.type || "Unknown type"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="text-red-600 hover:text-red-700 dark:text-red-300"
            onClick={() => setSelectedFile(null)}
            disabled={disabled}
          >
            Remove
          </Button>
        </div>
      )}

      {localError && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <AlertCircle className="size-4" aria-hidden="true" />
          <span>{localError}</span>
        </div>
      )}
    </div>
  );
}
