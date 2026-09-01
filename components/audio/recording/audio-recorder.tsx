/* eslint-disable no-restricted-syntax */

"use client";

import { useRef, useState } from "react";

import ProcessingLoader from "@/components/audio/processing/processing-loader";
import {
  type AudioDevice,
  MicrophonePermission,
} from "@/components/audio/recording/microphone-permission";
import { RecordingInProgress } from "@/components/audio/recording/recording-in-progress";
import RecordingSetup from "@/components/audio/recording/recording-setup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRecordingBackup } from "@/hooks/use-recording-backup";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { track } from "@/lib/analytics";

interface MicRecorderProps {
  onRecordingStop: (blob: Blob | null, backupId?: string | null) => void;
  onRecordingStart: () => void;
  disabled: boolean;
}

function AudioRecorderComponent({
  onRecordingStop,
  onRecordingStart,
  disabled,
}: MicRecorderProps) {
  const [error, setError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<
    "idle" | { state: "uploading"; progress: number }
  >("idle");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  const {
    currentBackupIdRef,
    startPeriodicBackup,
    stopPeriodicBackup,
    createPeriodicBackup,
    initializeRecordingStartTime,
    resetRecordingStartTime,
  } = useRecordingBackup(mediaRecorderRef, mediaChunksRef, recordingTime);

  const handlePermissionGranted = (devices: AudioDevice[]) => {
    setAudioDevices(devices);
    setSelectedDeviceId(devices[0].deviceId);
    setPermissionGranted(true);
    setError(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      setMediaStream(stream);

      const mimeTypes = [
        "video/mp4", // iOS primary format
        "audio/mp4", // Desktop MP4 format
        "audio/webm", // WebM fallback
      ];

      // Find the first supported MIME type
      let selectedMimeType = "";
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error("No supported MIME type found for audio recording");
      }

      const options = { mimeType: selectedMimeType };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      mediaChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (mediaChunksRef.current.length > 0) {
          const audioBlob = new Blob(mediaChunksRef.current, {
            type: selectedMimeType, // Use the selected MIME type
          });
          onRecordingStop(audioBlob, currentBackupIdRef.current);

          track("in_person_recording_completed", {
            duration_seconds: recordingTime,
            file_size_bytes: audioBlob.size,
          });
        }

        // Clean up
        stopPeriodicBackup();
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setRecordingTime(0);
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        resetRecordingStartTime();
        releaseWakeLock();
      };

      await requestWakeLock();
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      onRecordingStart();

      // Initialize the recording start time for accurate backup timestamps
      initializeRecordingStartTime();

      // Start backup after initial recording data is available
      setTimeout(() => {
        startPeriodicBackup();
      }, 5000); // Wait 5 seconds before starting backups

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unknown error occurred while accessing audio."
      );
    }
  };

  const stopRecording = () => {
    setProcessingStatus({ state: "uploading", progress: 0 });
    stopPeriodicBackup();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const togglePauseResume = () => {
    if (!mediaRecorderRef.current) return;

    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      void createPeriodicBackup(); // snapshot current chunks before the interval stops
      stopPeriodicBackup();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    } else if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      startPeriodicBackup();
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
  };

  // Render permission request screen
  if (!permissionGranted || !audioDevices.length) {
    return (
      <div className="space-y-4">
        <MicrophonePermission
          onPermissionGranted={handlePermissionGranted}
          onError={setError}
        />
      </div>
    );
  }

  // Render processing screen
  if (processingStatus !== "idle") {
    return (
      <div className="space-y-4">
        <ProcessingLoader
          status={processingStatus}
          onStopPolling={() => setProcessingStatus("idle")}
        />
      </div>
    );
  }

  // Render recording in progress
  if (isRecording) {
    return (
      <div className="space-y-4">
        <RecordingInProgress
          mediaStream={mediaStream}
          onStopRecording={stopRecording}
          togglePauseResume={togglePauseResume}
          isPaused={isPaused}
          recordingTime={recordingTime}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  // Render setup screen
  return (
    <div className="space-y-4">
      <RecordingSetup
        audioDevices={audioDevices}
        selectedDeviceId={selectedDeviceId}
        onDeviceChange={setSelectedDeviceId}
        onStartRecording={startRecording}
        disabled={disabled}
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default AudioRecorderComponent;
