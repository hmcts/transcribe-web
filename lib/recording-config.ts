/**
 * Recording Configuration
 *
 * Manages the maximum recording duration for audio and screen recordings.
 *
 * Configuration:
 * - NEXT_PUBLIC_MAX_RECORDING_MINUTES: Set the max recording duration
 * - Default: 115 minutes for all environments
 */

import { getEnv } from "@/lib/env";

const DEFAULT_MAX_RECORDING_MINUTES = 115;

/**
 * Get the maximum recording duration in seconds
 */
export function getMaxRecordingDuration(): number {
  const envValue = getEnv("NEXT_PUBLIC_MAX_RECORDING_MINUTES");

  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed * 60; // Convert minutes to seconds
    }
  }

  return DEFAULT_MAX_RECORDING_MINUTES * 60; // Convert to seconds
}

/**
 * Get the warning threshold (5 minutes before max duration) in seconds
 */
export function getWarningThreshold(): number {
  const maxDuration = getMaxRecordingDuration();
  const warningOffset = 5 * 60; // 5 minutes in seconds
  return maxDuration - warningOffset;
}

/**
 * Check if the recording should show a warning
 */
export function shouldShowWarning(elapsedSeconds: number): boolean {
  const warningThreshold = getWarningThreshold();
  return (
    elapsedSeconds >= warningThreshold &&
    elapsedSeconds < getMaxRecordingDuration()
  );
}

/**
 * Check if the recording has reached the maximum duration
 */
export function hasReachedMaxDuration(elapsedSeconds: number): boolean {
  return elapsedSeconds >= getMaxRecordingDuration();
}

/**
 * Get the remaining time until max duration in seconds
 */
export function getRemainingTime(elapsedSeconds: number): number {
  const maxDuration = getMaxRecordingDuration();
  return Math.max(0, maxDuration - elapsedSeconds);
}

/**
 * Format time remaining as MM:SS
 */
export function formatRemainingTime(remainingSeconds: number): string {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
