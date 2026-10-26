"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getNoSpeechWarningMs } from "@/lib/speech-session-health";
import { speechSessionTelemetry } from "@/lib/speech-session-telemetry";

/** How often the elapsed counter is refreshed while armed. */
const TICK_MS = 1000;

export interface UseNoSpeechWatchdogInput {
  /** Recording is meant to be running. */
  active: boolean;
  /** At least one segment has been captured since recording started. */
  hasCapturedSpeech: boolean;
  /** Overrides the configured threshold. Intended for tests. */
  thresholdMs?: number;
}

export interface UseNoSpeechWatchdogResult {
  /** Recording has been active this long with nothing captured. */
  shouldWarn: boolean;
  elapsedMs: number;
  thresholdMs: number;
}

/**
 * Warn when recording has been running for a while and has captured nothing.
 *
 * DIAAT-297: this is the cheapest and broadest guard in the fix. It does not
 * care *why* nothing arrived â€” a collapsing SDK session, a muted microphone, a
 * blocked WebSocket, a device the browser never opened. After the threshold, an
 * empty transcript is by itself enough to tell the user that their dictation is
 * not being saved.
 */
export function useNoSpeechWatchdog({
  active,
  hasCapturedSpeech,
  thresholdMs,
}: UseNoSpeechWatchdogInput): UseNoSpeechWatchdogResult {
  const configuredThresholdMs = useMemo(getNoSpeechWarningMs, []);
  const threshold = thresholdMs ?? configuredThresholdMs;

  const [elapsedMs, setElapsedMs] = useState(0);
  const reportedRef = useRef(false);

  const armed = active && !hasCapturedSpeech;

  useEffect(() => {
    if (!armed) {
      setElapsedMs(0);
      reportedRef.current = false;
      return;
    }

    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= threshold && !reportedRef.current) {
        reportedRef.current = true;
        speechSessionTelemetry.noSpeechCaptured({
          elapsedSeconds: Math.round(threshold / 1000),
        });
      }
    };

    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [armed, threshold]);

  return {
    shouldWarn: armed && elapsedMs >= threshold,
    elapsedMs,
    thresholdMs: threshold,
  };
}
