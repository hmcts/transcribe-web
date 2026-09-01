import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/indexeddb-backup", () => ({
  audioBackupDB: {
    saveAudioBackup: vi.fn().mockResolvedValue(undefined),
  },
  IndexedDBBackup: {
    generateBackupId: vi.fn().mockReturnValue("backup-id-123"),
  },
}));

import { useRecordingBackup } from "@/hooks/use-recording-backup";
import { audioBackupDB, IndexedDBBackup } from "@/lib/indexeddb-backup";

describe("useRecordingBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeRefs(mimeType = "audio/webm") {
    const mediaRecorderRef = {
      current: { mimeType } as unknown as MediaRecorder,
    };
    const mediaChunksRef = {
      current: [new Blob(["chunk"], { type: mimeType })],
    };
    return { mediaRecorderRef, mediaChunksRef };
  }

  it("returns expected functions", () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );
    expect(typeof result.current.startPeriodicBackup).toBe("function");
    expect(typeof result.current.stopPeriodicBackup).toBe("function");
    expect(typeof result.current.createPeriodicBackup).toBe("function");
    expect(typeof result.current.initializeRecordingStartTime).toBe("function");
    expect(typeof result.current.resetRecordingStartTime).toBe("function");
  });

  it("createPeriodicBackup saves backup to indexedDB", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    expect(audioBackupDB.saveAudioBackup).toHaveBeenCalled();
  });

  it("createPeriodicBackup does nothing when mediaRecorder is null", async () => {
    const mediaRecorderRef = { current: null };
    const mediaChunksRef = { current: [] };
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    expect(audioBackupDB.saveAudioBackup).not.toHaveBeenCalled();
  });

  it("createPeriodicBackup does nothing when chunks are empty", async () => {
    const { mediaRecorderRef } = makeRefs();
    const mediaChunksRef = { current: [] };
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    expect(audioBackupDB.saveAudioBackup).not.toHaveBeenCalled();
  });

  it("startPeriodicBackup triggers backup on interval", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    act(() => {
      result.current.startPeriodicBackup();
    });

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    expect(audioBackupDB.saveAudioBackup).toHaveBeenCalled();
  });

  it("stopPeriodicBackup stops the interval", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    act(() => {
      result.current.startPeriodicBackup();
      result.current.stopPeriodicBackup();
    });

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    expect(audioBackupDB.saveAudioBackup).not.toHaveBeenCalled();
  });

  it("generateBackupId is called on first backup creation", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    expect(IndexedDBBackup.generateBackupId).toHaveBeenCalled();
  });

  it("initializeRecordingStartTime sets start time", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    act(() => {
      result.current.initializeRecordingStartTime();
    });

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    const call = vi.mocked(audioBackupDB.saveAudioBackup).mock.calls[0][0];
    expect(call.recordingDuration).toBeGreaterThanOrEqual(0);
  });

  it("resetRecordingStartTime clears backup id", async () => {
    const { mediaRecorderRef, mediaChunksRef } = makeRefs();
    const { result } = renderHook(() =>
      useRecordingBackup(mediaRecorderRef, mediaChunksRef, 0)
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    act(() => {
      result.current.resetRecordingStartTime();
    });

    vi.mocked(IndexedDBBackup.generateBackupId).mockReturnValue(
      "new-backup-id"
    );

    await act(async () => {
      await result.current.createPeriodicBackup();
    });

    expect(IndexedDBBackup.generateBackupId).toHaveBeenCalledTimes(2);
  });
});
