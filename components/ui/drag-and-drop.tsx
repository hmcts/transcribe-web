/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-nested-ternary */
/* eslint-disable jsx-a11y/label-has-associated-control */

"use client";

import type React from "react";
import { useDropzone } from "react-dropzone";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface DragAndDropUploaderProps {
  onAudioFileSelect: (file: File | Blob) => void;
  acceptedFileTypes: string;
  selectedFileName: string | undefined;
  setErrorMessage: (message: string | null) => void;
}

export default function DragAndDropUploader({
  onAudioFileSelect,
  acceptedFileTypes,
  selectedFileName,
  setErrorMessage,
}: DragAndDropUploaderProps) {
  const accept = acceptedFileTypes.split(",").reduce(
    (acc, type) => {
      const trimmedType = type.trim();
      // Handle MIME type patterns (e.g., audio/*)
      if (trimmedType.includes("/")) {
        acc[trimmedType] = [];
      }
      // Handle file extensions (e.g., .mp3)
      else {
        const mimeType = trimmedType.startsWith(".")
          ? `application/${trimmedType.slice(1)}` // .json -> application/json
          : "application/octet-stream"; // fallback
        acc[mimeType] = [trimmedType];
      }
      return acc;
    },
    {} as Record<string, string[]>
  );

  const handleFileLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    onAudioFileSelect(selectedFile);
    setErrorMessage(null);
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      accept,
      multiple: false,
      onDrop: (files) => {
        if (files[0]) {
          const syntheticEvent = new Event("change", {
            bubbles: true,
          }) as unknown as React.ChangeEvent<HTMLInputElement>;
          Object.defineProperty(syntheticEvent, "target", {
            writable: true,
            value: { files },
          });
          handleFileLoad(syntheticEvent);
        }
      },
    });

  return (
    <div
      className={cn(
        "group relative cursor-pointer",
        isDragActive && "opacity-70"
      )}
    >
      <div
        {...getRootProps()}
        className={cn(
          "relative flex min-h-[160px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 p-6 transition-all",
          isDragActive && !isDragReject && "border-blue-400 bg-blue-50/50",
          isDragReject && "border-red-400 bg-red-50/50",
          !isDragActive && "hover:border-blue-400",
          selectedFileName && "bg-gray-50/50",
          "dark:border-gray-700 dark:hover:border-blue-500"
        )}
      >
        {!selectedFileName ? (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
            <svg
              className={cn(
                "h-10 w-10 opacity-75 transition-transform",
                isDragActive && "scale-110"
              )}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-sm font-medium">
              {isDragActive
                ? !isDragReject
                  ? "Drop to upload"
                  : "This file type is not supported"
                : "Drag and drop your files here"}
            </span>
            <span className="text-xs text-gray-400">or</span>
            <label
              htmlFor="file-upload"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-900/75"
            >
              Choose File
            </label>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              File ready to upload
            </span>
            <label
              htmlFor="file-upload"
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-400 dark:hover:bg-green-900/75"
            >
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {selectedFileName}
            </label>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Click to change file
            </span>
          </div>
        )}
        <Input
          {...getInputProps()}
          accept={acceptedFileTypes}
          className="sr-only"
        />
      </div>
    </div>
  );
}
