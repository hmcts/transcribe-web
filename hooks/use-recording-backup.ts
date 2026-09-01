import { type MutableRefObject, useCallback, useRef } from "react";
import {
  type AudioBackup,
  audioBackupDB,
  IndexedDBBackup,
} from "@/lib/indexeddb-backup";

export function useRecordingBackup(
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>,
  mediaChunksRef: MutableRefObject<Blob[]>,
  _recordingTime: number
) {
  const backupIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentBackupIdRef = useRef<string | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);

  const createPeriodicBackup = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaChunksRef.current.length === 0) {
      return;
    }

    try {
      const selectedMimeType = mediaRecorderRef.current.mimeType;
      const currentChunks = [...mediaChunksRef.current];
      const audioBlob = new Blob(currentChunks, { type: selectedMimeType });

      if (!currentBackupIdRef.current) {
        currentBackupIdRef.current = IndexedDBBackup.generateBackupId();
      }

      // Calculate current recording duration from start time
      const currentDuration = recordingStartTimeRef.current
        ? Math.floor((Date.now() - recordingStartTimeRef.current) / 1000)
        : 0;

      const backup: AudioBackup = {
        id: currentBackupIdRef.current,
        blob: audioBlob,
        fileName: `recording_${new Date().toISOString()}.${selectedMimeType.includes("mp4") ? "mp4" : "webm"}`,
        timestamp: Date.now(),
        mimeType: selectedMimeType,
        recordingDuration: currentDuration,
      };

      await audioBackupDB.saveAudioBackup(backup);
    } catch (err) {
      console.error("Failed to create periodic backup:", err);
    }
  }, [mediaRecorderRef, mediaChunksRef]);

  const startPeriodicBackup = useCallback(() => {
    if (backupIntervalRef.current) {
      clearInterval(backupIntervalRef.current);
    }

    backupIntervalRef.current = setInterval(() => {
      createPeriodicBackup();
    }, 15000); // Backup every 15 seconds
  }, [createPeriodicBackup]);

  const stopPeriodicBackup = useCallback(() => {
    if (backupIntervalRef.current) {
      clearInterval(backupIntervalRef.current);
      backupIntervalRef.current = null;
    }
  }, []);

  const initializeRecordingStartTime = useCallback(() => {
    recordingStartTimeRef.current = Date.now();
  }, []);

  const resetRecordingStartTime = useCallback(() => {
    recordingStartTimeRef.current = null;
    currentBackupIdRef.current = null;
  }, []);

  return {
    currentBackupIdRef,
    startPeriodicBackup,
    stopPeriodicBackup,
    createPeriodicBackup,
    initializeRecordingStartTime,
    resetRecordingStartTime,
  };
}
