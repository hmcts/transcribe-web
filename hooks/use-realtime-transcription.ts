"use client";

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import {
  deriveSpeechHealth,
  getCollapseThreshold,
  getCollapseWindowMs,
  isUnhealthyCollapseCount,
  pruneCollapseTimestamps,
  reconnectDelayMs,
  type SpeechCancellationInfo,
  type SpeechSessionHealth,
} from "@/lib/speech-session-health";
import { speechSessionTelemetry } from "@/lib/speech-session-telemetry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptionSegment {
  /** Unique ID for this segment */
  id: string;
  /** Speaker ID (e.g., "Guest-1", "Guest-2") or "Unknown" */
  speaker: string;
  /** Accumulated transcript text */
  text: string;
  /** Whether the transcription for this segment is final */
  isFinal: boolean;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected";

/** Everything the UI needs to tell the truth about the session (DIAAT-297). */
export interface SpeechSessionState {
  health: SpeechSessionHealth;
  /** Collapses inside the sliding detection window. */
  collapsesInWindow: number;
  /** Collapses since the user last pressed start. Never self-clears. */
  totalCollapses: number;
  lastCancellation: SpeechCancellationInfo | null;
}

// Speech tuning profile:
// - keep partials responsive
// - segment utterances on short pauses
// - keep the connection alive through long natural pauses (30 s)
const SPEECH_TUNING = {
  segmentationSilenceMs: 1800,
  endSilenceMs: 30000,
  initialSilenceMs: 20000,
  stablePartialThreshold: 2,
} as const;

/** How often the sliding collapse window is re-evaluated while recording. */
const HEALTH_HEARTBEAT_MS = 2000;

const IDLE_SESSION: SpeechSessionState = {
  health: "idle",
  collapsesInWindow: 0,
  totalCollapses: 0,
  lastCancellation: null,
};

export interface UseRealtimeTranscriptionReturn {
  status: ConnectionStatus;
  segments: TranscriptionSegment[];
  error: string | null;
  session: SpeechSessionState;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Resolve a numeric SDK enum value to its name.
 *
 * Reverse lookup rather than `Enum[value]` so a reason we do not have a name for
 * still lands in telemetry as a number instead of `undefined`.
 */
function enumName(
  enumObject: Record<string, unknown>,
  value: unknown
): string | undefined {
  if (value === undefined || value === null) return undefined;
  for (const [key, candidate] of Object.entries(enumObject)) {
    if (candidate === value && Number.isNaN(Number(key))) return key;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRealtimeTranscription(): UseRealtimeTranscriptionReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SpeechSessionState>(IDLE_SESSION);

  const collapseThreshold = useMemo(getCollapseThreshold, []);
  const collapseWindowMs = useMemo(getCollapseWindowMs, []);

  const recognizerRef = useRef<sdk.ConversationTranscriber | null>(null);
  /**
   * Recognizers asked to stop whose stop has not completed. The SDK can still
   * deliver the final result of the utterance in progress while it stops, so
   * those are accepted from here; every other event from them is stale.
   */
  const stoppingRef = useRef<Set<sdk.ConversationTranscriber>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  // Monotonic for the lifetime of the hook. Never reset per session: the
  // consumer de-duplicates finalised segments by id, so a session that restarts
  // its numbering makes newly captured speech look like an already-seen
  // duplicate and it gets dropped (DIAAT-297).
  const segmentCounterRef = useRef(0);
  const currentSegmentIdRef = useRef<string | null>(null);

  // --- session health bookkeeping ---
  /** The user has asked to be recording. Distinguishes a collapse from a stop. */
  const recordingIntendedRef = useRef(false);
  const sdkConnectedRef = useRef(false);
  const collapseTimestampsRef = useRef<number[]>([]);
  const totalCollapsesRef = useRef(0);
  const lastCancellationRef = useRef<SpeechCancellationInfo | null>(null);
  const unhealthyReportedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIndexRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const sessionSegmentCountRef = useRef(0);
  const pendingReconnectAttemptRef = useRef(0);
  /** Speech SDK session ID of the current session, for telemetry (OBS-4). */
  const speechSessionIdRef = useRef<string | undefined>(undefined);
  const firstTextReportedRef = useRef(false);
  // startSession and handleTermination are mutually recursive.
  const startSessionRef = useRef<(() => Promise<void>) | null>(null);

  // ------------------------------------------------------------------
  // Health publishing
  // ------------------------------------------------------------------

  const publishSession = useCallback(() => {
    collapseTimestampsRef.current = pruneCollapseTimestamps(
      collapseTimestampsRef.current,
      Date.now(),
      collapseWindowMs
    );
    const collapsesInWindow = collapseTimestampsRef.current.length;

    if (!isUnhealthyCollapseCount(collapsesInWindow, collapseThreshold)) {
      // Allow a fresh report if the session degrades again after recovering.
      unhealthyReportedRef.current = false;
    }

    const health = deriveSpeechHealth({
      recordingIntended: recordingIntendedRef.current,
      sdkConnected: sdkConnectedRef.current,
      collapsesInWindow,
      collapseThreshold,
    });

    setSession((previous) => {
      if (
        previous.health === health &&
        previous.collapsesInWindow === collapsesInWindow &&
        previous.totalCollapses === totalCollapsesRef.current &&
        previous.lastCancellation === lastCancellationRef.current
      ) {
        return previous;
      }
      return {
        health,
        collapsesInWindow,
        totalCollapses: totalCollapsesRef.current,
        lastCancellation: lastCancellationRef.current,
      };
    });
  }, [collapseThreshold, collapseWindowMs]);

  // Re-evaluate the sliding window on a timer as well as on events, so a
  // session that genuinely recovers stops claiming to be broken.
  useEffect(() => {
    if (session.health === "idle") return;
    const interval = setInterval(publishSession, HEALTH_HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [session.health, publishSession]);

  // ------------------------------------------------------------------
  // Teardown
  // ------------------------------------------------------------------

  /** Tear down the SDK objects without touching intent or health. */
  const teardownSession = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const recognizer = recognizerRef.current;
    recognizerRef.current = null;
    if (recognizer) {
      const stopping = stoppingRef.current;
      stopping.add(recognizer);
      recognizer.stopTranscribingAsync(
        () => {
          stopping.delete(recognizer);
          recognizer.close();
        },
        (err) => {
          console.error("[speech] Error stopping recognizer:", err);
          stopping.delete(recognizer);
          recognizer.close();
        }
      );
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    sdkConnectedRef.current = false;
  }, []);

  const disconnect = useCallback(() => {
    // A user stop is a pause even when no session is connected (e.g. while a
    // reconnect is pending after a collapse).
    if (recordingIntendedRef.current) speechSessionTelemetry.paused();
    if (recordingIntendedRef.current && sessionStartedAtRef.current !== 0) {
      speechSessionTelemetry.sessionStopped({
        sessionId: speechSessionIdRef.current,
        sessionIndex: sessionIndexRef.current,
        durationMs: sessionStartedAtRef.current
          ? Date.now() - sessionStartedAtRef.current
          : 0,
        segmentsCaptured: sessionSegmentCountRef.current,
        userInitiated: true,
      });
    }
    recordingIntendedRef.current = false;
    // Clear before teardown: the stopping recognizer may deliver its final
    // result during the stop, and that must land after the clear, not before.
    currentSegmentIdRef.current = null;
    setSegments([]);
    teardownSession();
    collapseTimestampsRef.current = [];
    totalCollapsesRef.current = 0;
    lastCancellationRef.current = null;
    unhealthyReportedRef.current = false;
    setStatus("disconnected");
    setSession(IDLE_SESSION);
  }, [teardownSession]);

  useEffect(
    () => () => {
      recordingIntendedRef.current = false;
      teardownSession();
    },
    [teardownSession]
  );

  // ------------------------------------------------------------------
  // Collapse handling
  // ------------------------------------------------------------------

  /**
   * A session ended without the user asking for it. Record it, report it, and
   * schedule a backed-off reconnect.
   *
   * Every unexpected termination lands here, whatever the SDK called it. The
   * pre-fix code only reacted to `CancellationReason.Error` and let every other
   * ending â€” including a bare `sessionStopped` â€” restart the session through a
   * render effect with no error state, no backoff and no signal to the user.
   */
  const handleCollapse = useCallback(
    (cancellation: SpeechCancellationInfo | null) => {
      if (!recordingIntendedRef.current) return;

      const sessionIndex = sessionIndexRef.current;
      const sessionId = speechSessionIdRef.current;
      const durationMs = sessionStartedAtRef.current
        ? Date.now() - sessionStartedAtRef.current
        : 0;
      const segmentsCaptured = sessionSegmentCountRef.current;
      sessionStartedAtRef.current = 0;

      teardownSession();
      setStatus("connecting");

      collapseTimestampsRef.current = pruneCollapseTimestamps(
        [...collapseTimestampsRef.current, Date.now()],
        Date.now(),
        collapseWindowMs
      );
      totalCollapsesRef.current += 1;
      if (cancellation) lastCancellationRef.current = cancellation;

      const collapsesInWindow = collapseTimestampsRef.current.length;

      if (cancellation) {
        speechSessionTelemetry.sessionCanceled({
          sessionId,
          sessionIndex,
          cancellation,
          collapsesInWindow,
        });
      }
      speechSessionTelemetry.sessionStopped({
        sessionId,
        sessionIndex,
        durationMs,
        segmentsCaptured,
        userInitiated: false,
      });

      if (
        isUnhealthyCollapseCount(collapsesInWindow, collapseThreshold) &&
        !unhealthyReportedRef.current
      ) {
        unhealthyReportedRef.current = true;
        speechSessionTelemetry.sessionUnhealthy({
          collapsesInWindow,
          windowSeconds: Math.round(collapseWindowMs / 1000),
          cancellation: lastCancellationRef.current,
        });
      }

      publishSession();

      // Back off, but keep trying. A judge mid-hearing is better served by a
      // session that keeps attempting to recover behind a banner that says
      // plainly that nothing is being captured.
      pendingReconnectAttemptRef.current = collapsesInWindow;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!recordingIntendedRef.current) return;
        void startSessionRef.current?.();
      }, reconnectDelayMs(collapsesInWindow));
    },
    [collapseThreshold, collapseWindowMs, publishSession, teardownSession]
  );

  // ------------------------------------------------------------------
  // Session start
  // ------------------------------------------------------------------

  const startSession = useCallback(async () => {
    /** Guards against a single collapse being handled twice. */
    let terminated = false;
    const terminate = (cancellation: SpeechCancellationInfo | null) => {
      if (terminated) return;
      terminated = true;
      handleCollapse(cancellation);
    };

    try {
      setStatus("connecting");
      sessionIndexRef.current += 1;
      sessionSegmentCountRef.current = 0;
      speechSessionIdRef.current = undefined;
      firstTextReportedRef.current = false;
      speechSessionTelemetry.recordingRequested({
        sessionIndex: sessionIndexRef.current,
        reconnectAttempt: pendingReconnectAttemptRef.current,
      });

      // 1. Fetch Speech Service token from FastAPI
      const tokenRequestedAt = Date.now();
      const result = await apiClient.getSpeechToken();
      speechSessionTelemetry.tokenFetched({
        ok: !result.error && Boolean(result.data),
        status: result.status,
        durationMs: Date.now() - tokenRequestedAt,
      });
      if (result.error || !result.data) {
        throw new Error(result.error || "Failed to get speech token");
      }
      const { token, endpoint }: { token: string; endpoint: string } =
        result.data;

      if (!recordingIntendedRef.current) return;

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!recordingIntendedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;

      // 3. Create Speech SDK configuration
      const speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint));
      speechConfig.authorizationToken = token;
      speechConfig.speechRecognitionLanguage = "en-GB";
      speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      speechConfig.enableDictation();
      speechConfig.requestWordLevelTimestamps();
      speechConfig.setProfanity(sdk.ProfanityOption.Raw);

      // Endpointing tuned for "snappy but natural" prose capture.
      speechConfig.setProperty(
        "Speech_SegmentationSilenceTimeoutMs",
        String(SPEECH_TUNING.segmentationSilenceMs)
      );
      speechConfig.setProperty(
        "SpeechServiceConnection_EndSilenceTimeoutMs",
        String(SPEECH_TUNING.endSilenceMs)
      );
      speechConfig.setProperty(
        "SpeechServiceConnection_InitialSilenceTimeoutMs",
        String(SPEECH_TUNING.initialSilenceMs)
      );
      speechConfig.setProperty(
        "SpeechServiceResponse_StablePartialResultThreshold",
        String(SPEECH_TUNING.stablePartialThreshold)
      );

      // Enable diarization (speaker identification)
      // Note: These properties follow the C# SDK pattern; JavaScript support may vary
      speechConfig.setProperty(
        "SpeechServiceResponse_DiarizeIntermediateResults",
        "true"
      );
      speechConfig.setProperty(
        "SpeechServiceConnection_EnableSpeakerDiarization",
        "true"
      );

      // 4. Create audio config from the microphone stream
      const audioConfig = sdk.AudioConfig.fromStreamInput(stream);

      // 5. Create conversation transcriber (supports diarization)
      const transcriber = new sdk.ConversationTranscriber(
        speechConfig,
        audioConfig
      );
      recognizerRef.current = transcriber;
      const sessionIndex = sessionIndexRef.current;
      currentSegmentIdRef.current = null;

      /** Ignore late events from a session we have already torn down. */
      const isCurrent = () => recognizerRef.current === transcriber;
      /**
       * This recognizer's utterance in progress. Unlike currentSegmentIdRef it
       * is not reset when the session stops or replaced by a newer session, so
       * a final flushed during the stop keeps the id (and with it the section)
       * its interim result was given.
       */
      let partialSegmentId: string | null = null;

      /** OBS-4: start-to-first-text, once per speech session. */
      const reportFirstText = (sessionId: string | undefined, text: string) => {
        if (firstTextReportedRef.current || !text) return;
        firstTextReportedRef.current = true;
        speechSessionTelemetry.firstText({ sessionId, sessionIndex });
      };

      // ------------------------------------------------------------------
      // Event handlers
      // ------------------------------------------------------------------

      // Partial results (while speaking)
      transcriber.transcribing = (_s, e) => {
        if (!isCurrent()) return;
        if (e.result.reason === sdk.ResultReason.RecognizingSpeech) {
          const speaker = e.result.speakerId || "Unknown";
          const text = e.result.text || "";
          reportFirstText(e.sessionId, text);

          if (!currentSegmentIdRef.current) {
            currentSegmentIdRef.current = `seg-${++segmentCounterRef.current}`;
          }
          const segmentId = currentSegmentIdRef.current;
          partialSegmentId = segmentId;

          setSegments((prev) => {
            const idx = prev.findIndex((s) => s.id === segmentId);
            if (idx >= 0) {
              const existing = prev[idx];
              // Skip no-op interim updates to keep UI rendering snappy.
              if (
                existing.speaker === speaker &&
                existing.text === text &&
                existing.isFinal === false
              ) {
                return prev;
              }
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                speaker,
                text,
                isFinal: false,
              };
              return updated;
            }
            return [...prev, { id: segmentId, speaker, text, isFinal: false }];
          });
        }
      };

      // Final results (when speech segment is complete). Also accepted while
      // this recognizer is stopping, so pausing mid-sentence keeps the last
      // utterance: the SDK delivers it during stopTranscribingAsync, after
      // teardown has already cleared recognizerRef.
      transcriber.transcribed = (_s, e) => {
        const current = isCurrent();
        if (!current && !stoppingRef.current.has(transcriber)) return;
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          const speaker = e.result.speakerId || "Unknown";
          const text = e.result.text || "";
          // A stopping recognizer uses its own interim id, never
          // currentSegmentIdRef, which may already belong to an utterance in a
          // newer session. Reusing the interim id keeps the final in the section
          // where the utterance started (dictation.tsx maps ids to sections).
          const segmentId =
            (current ? currentSegmentIdRef.current : partialSegmentId) ??
            `seg-${++segmentCounterRef.current}`;
          partialSegmentId = null;
          if (!current) {
            // Counted in the dictation session (OBS-4), not in the stopped
            // Speech session, whose summary has already been reported.
            if (text.trim()) speechSessionTelemetry.segmentCaptured();
            setSegments((prev) => [
              ...prev,
              { id: segmentId, speaker, text, isFinal: true },
            ]);
            return;
          }
          sessionSegmentCountRef.current += 1;
          reportFirstText(e.sessionId, text);
          speechSessionTelemetry.segmentCaptured();

          // Finalize the current segment; if no interim event fired, create one now.
          setSegments((prev) => {
            const idx = prev.findIndex((s) => s.id === segmentId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                speaker,
                text,
                isFinal: true,
              };
              return updated;
            }
            return [...prev, { id: segmentId, speaker, text, isFinal: true }];
          });
          currentSegmentIdRef.current = null;
        } else if (e.result.reason === sdk.ResultReason.NoMatch) {
          partialSegmentId = null;
          if (current) {
            console.info("[speech] No match - speech could not be recognized");
            currentSegmentIdRef.current = null;
          }
        }
      };

      // Cancellation. Every reason is treated as the session ending, because
      // from the user's point of view it has: nothing is being captured until a
      // new session is up. The reason and error code go to telemetry so the
      // difference is still visible to us.
      transcriber.canceled = (_s, e) => {
        if (!isCurrent()) return;
        const cancellation: SpeechCancellationInfo = {
          reason: enumName(sdk.CancellationReason, e.reason) ?? "Unknown",
          errorCode: enumName(sdk.CancellationErrorCode, e.errorCode),
          errorDetails: e.errorDetails || undefined,
        };
        if (e.reason === sdk.CancellationReason.Error) {
          const errorMsg = `Error: ${cancellation.errorCode} - ${e.errorDetails}`;
          console.error("[speech]", errorMsg);
          setError(errorMsg);
        } else {
          console.warn(
            `[speech] session canceled: ${cancellation.reason}`,
            e.errorDetails
          );
        }
        terminate(cancellation);
      };

      transcriber.sessionStopped = (_s, _e) => {
        if (!isCurrent()) return;
        // Unexpected: the user has not paused, so this is a collapse.
        terminate(null);
      };

      transcriber.sessionStarted = (_s, e) => {
        if (!isCurrent()) return;
        sdkConnectedRef.current = true;
        sessionStartedAtRef.current = Date.now();
        speechSessionIdRef.current = e?.sessionId || undefined;
        setStatus("connected");
        speechSessionTelemetry.sessionStarted({
          sessionId: speechSessionIdRef.current,
          sessionIndex,
          reconnectAttempt: pendingReconnectAttemptRef.current,
        });
        publishSession();
      };

      // ------------------------------------------------------------------
      // Start transcription
      // ------------------------------------------------------------------

      transcriber.startTranscribingAsync(
        () => {
          console.info("[speech] Transcription started successfully");
        },
        (err) => {
          const errorMsg = `Failed to start transcription: ${err}`;
          console.error("[speech]", errorMsg);
          setError(errorMsg);
          terminate({ reason: "StartFailed", errorDetails: String(err) });
        }
      );

      publishSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect";
      setError(message);
      // Counted as a collapse so a session that can never start is reported and
      // escalated exactly like one that keeps dropping.
      terminate({ reason: "StartFailed", errorDetails: message });
    }
  }, [handleCollapse, publishSession]);

  // Assigned in an effect rather than during render so the hook stays free of
  // render-phase side effects.
  useEffect(() => {
    startSessionRef.current = startSession;
  }, [startSession]);

  // ------------------------------------------------------------------
  // Connect (user-initiated)
  // ------------------------------------------------------------------

  const connect = useCallback(async () => {
    setError(null);
    sessionStartedAtRef.current = 0;
    setSegments([]);
    currentSegmentIdRef.current = null;
    recordingIntendedRef.current = true;
    collapseTimestampsRef.current = [];
    totalCollapsesRef.current = 0;
    lastCancellationRef.current = null;
    unhealthyReportedRef.current = false;
    pendingReconnectAttemptRef.current = 0;
    publishSession();
    await startSession();
  }, [publishSession, startSession]);

  return { status, segments, error, session, connect, disconnect };
}
