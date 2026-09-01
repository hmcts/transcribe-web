"use client";

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { useCallback, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";

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

export interface UseRealtimeTranscriptionReturn {
  status: ConnectionStatus;
  segments: TranscriptionSegment[];
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRealtimeTranscription(): UseRealtimeTranscriptionReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<sdk.ConversationTranscriber | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentCounterRef = useRef(0);

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (recognizerRef.current) {
      recognizerRef.current.stopTranscribingAsync(
        () => {
          recognizerRef.current?.close();
          recognizerRef.current = null;
        },
        (err) => {
          console.error("[speech] Error stopping recognizer:", err);
          recognizerRef.current?.close();
          recognizerRef.current = null;
        }
      );
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
    setStatus("disconnected");
    setSegments([]);
  }, [cleanup]);

  // ------------------------------------------------------------------
  // Connect
  // ------------------------------------------------------------------

  const connect = useCallback(async () => {
    try {
      setError(null);
      setStatus("connecting");
      setSegments([]);
      segmentCounterRef.current = 0;

      // 1. Fetch Speech Service token from FastAPI
      const result = await apiClient.getSpeechToken();
      if (result.error || !result.data) {
        throw new Error(result.error || "Failed to get speech token");
      }
      const { token, endpoint }: { token: string; endpoint: string } =
        result.data;

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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

      // Track the current partial segment
      let currentSegmentId: string | null = null;

      // ------------------------------------------------------------------
      // Event handlers
      // ------------------------------------------------------------------

      // Partial results (while speaking)
      transcriber.transcribing = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizingSpeech) {
          const speaker = e.result.speakerId || "Unknown";
          const text = e.result.text || "";

          // Create a new segment ID if we don't have one
          if (!currentSegmentId) {
            currentSegmentId = `seg-${++segmentCounterRef.current}`;
          }

          setSegments((prev) => {
            const idx = prev.findIndex((s) => s.id === currentSegmentId);
            if (!currentSegmentId) return prev;
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
            return [
              ...prev,
              {
                id: currentSegmentId,
                speaker,
                text,
                isFinal: false,
              },
            ];
          });
        }
      };

      // Final results (when speech segment is complete)
      transcriber.transcribed = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          const speaker = e.result.speakerId || "Unknown";
          const text = e.result.text || "";
          const segmentId =
            currentSegmentId ?? `seg-${++segmentCounterRef.current}`;

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
            return [
              ...prev,
              {
                id: segmentId,
                speaker,
                text,
                isFinal: true,
              },
            ];
          });
          currentSegmentId = null;
        } else if (e.result.reason === sdk.ResultReason.NoMatch) {
          console.info("[speech] No match - speech could not be recognized");
          currentSegmentId = null;
        }
      };

      // Errors
      transcriber.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) {
          const errorMsg = `Error: ${e.errorCode} - ${e.errorDetails}`;
          console.error("[speech]", errorMsg);
          setError(errorMsg);
          cleanup();
          setStatus("disconnected");
        }
        // EndOfStream (e.g. silence timeout) is expected during normal operation.
        // Don't treat it as an error or force cleanup here; let the SDK and/or
        // sessionStopped/disconnect flows manage lifecycle.
      };

      // Session stopped
      transcriber.sessionStopped = (_s, _e) => {
        cleanup();
        setStatus("disconnected");
      };

      // Session started
      transcriber.sessionStarted = (_s, _e) => {
        setStatus("connected");
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
          cleanup();
          setStatus("disconnected");
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect";
      setError(message);
      cleanup();
      setStatus("disconnected");
    }
  }, [cleanup]);

  return { status, segments, error, connect, disconnect };
}
