"use client";

import { useEffect, useState } from "react";

export default function ProcessingStatus({
  estimatedSeconds,
  startTime,
}: {
  estimatedSeconds: number;
  startTime: number;
}) {
  const [timeRemaining, setTimeRemaining] = useState(estimatedSeconds);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, estimatedSeconds - elapsed);
      // eslint-disable-next-line no-console
      setTimeRemaining(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [estimatedSeconds, startTime]);

  const formatTimeRemaining = () => {
    if (timeRemaining >= 90) {
      const minutes = Math.ceil(timeRemaining / 60);
      return `ETA: ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }

    if (timeRemaining >= 60) {
      return "ETA: 1 minute";
    }

    return "ETA: under a minute";
  };

  return (
    <div className="flex items-center justify-center gap-2">
      <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <span>Transcribing</span>
      <span className="text-white/80">({formatTimeRemaining()})</span>
    </div>
  );
}

export const getDuration = (file: Blob | File): Promise<number | null> => {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };

      audio.addEventListener("loadedmetadata", () => {
        if (
          audio.duration === Number.POSITIVE_INFINITY ||
          Number.isNaN(audio.duration)
        ) {
          audio.currentTime = 24 * 60 * 60;
          audio.addEventListener("timeupdate", function getDur() {
            if (audio.duration !== Number.POSITIVE_INFINITY) {
              URL.revokeObjectURL(url);
              audio.removeEventListener("timeupdate", getDur);
              resolve(audio.duration);
            }
          });
        } else {
          URL.revokeObjectURL(url);
          resolve(audio.duration);
        }
      });
    } catch (error) {
      console.warn("Failed to calculate audio duration:", error);
      resolve(null);
    }
  });
};

export const calculateEstimatedProcessingTime = (
  audioDurationSeconds: number
) => {
  if (audioDurationSeconds > 2 * 60 * 60) {
    return audioDurationSeconds * 0.08333333333;
  }

  return audioDurationSeconds * 0.03724437408;
};
