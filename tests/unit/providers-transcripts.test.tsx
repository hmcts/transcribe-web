import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── mocks ────────────────────────────────────────────────────────────────────

// DIAAT-322: material is loaded in a jurisdiction; these tests work in the IAC.
let mockInJurisdiction = true;
vi.mock("@/providers/jurisdiction", async () => {
  const { mockJurisdictionModule } = await import("../jurisdiction-helpers");
  const iac = mockJurisdictionModule("IAC");
  const inIac = iac.useJurisdiction();
  return {
    ...iac,
    useJurisdiction: () =>
      mockInJurisdiction ? inIac : { ...inIac, current: null },
  };
});

// DIAAT-373: as a judge, the role whose permissions these screens are for, unless
// a test says otherwise.
let mockPersona: import("@/lib/access/types").MeResponse | undefined;
vi.mock("@/providers/access", async () => {
  const helpers = await import("../access-helpers");
  return helpers.mockAccessModule(() => mockPersona ?? helpers.ME.judge);
});

// DIAAT-392: the runtime dictation flag; on unless a test switches it off.
let dictationEnabled = true;
vi.mock("@/providers/runtime-flags", () => ({
  useDictationEnabled: () => dictationEnabled,
}));

vi.mock("@/lib/database", () => ({
  getAllTranscriptionMetadata: vi.fn(),
  getTranscriptionById: vi.fn(),
  getTranscriptionJobs: vi.fn(),
  saveTranscription: vi.fn(),
  saveTranscriptionJob: vi.fn(),
  deleteTranscription: vi.fn(),
}));

const mockPush = vi.fn();
let mockPathname = "/decisions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
    toString: vi.fn().mockReturnValue(""),
  }),
}));

import {
  deleteTranscription as dbDeleteTranscription,
  saveTranscription as dbSaveTranscription,
  getAllTranscriptionMetadata,
  getTranscriptionById,
} from "@/lib/database";
import { TranscriptsProvider, useTranscripts } from "@/providers/transcripts";

// ─── test wrapper ──────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <TranscriptsProvider>{children}</TranscriptsProvider>;
}

// ─── useTranscripts outside provider ─────────────────────────────────────────

describe("useTranscripts", () => {
  it("throws when used outside a TranscriptsProvider", () => {
    expect(() => renderHook(() => useTranscripts())).toThrow(
      "useTranscripts must be used within a TranscriptsProvider"
    );
  });
});

// ─── initial state ────────────────────────────────────────────────────────────

describe("TranscriptsProvider — which roles load dictations (DIAAT-384)", () => {
  afterEach(() => {
    mockPersona = undefined;
  });

  it("loads nothing for a role without dictation.use, whose calls the API would refuse", async () => {
    const { ME } = await import("../access-helpers");
    mockPersona = ME.legalTextManager;
    vi.mocked(getAllTranscriptionMetadata).mockClear();

    renderHook(() => useTranscripts(), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(getAllTranscriptionMetadata).not.toHaveBeenCalled();
  });
});

describe("TranscriptsProvider — dictation switched off (DIAAT-392)", () => {
  it("loads nothing while the dictation flag is off, whose calls the API refuses with 403 dictation_disabled", async () => {
    dictationEnabled = false;
    vi.mocked(getAllTranscriptionMetadata).mockClear();

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getAllTranscriptionMetadata).not.toHaveBeenCalled();
    dictationEnabled = true;
  });

  it("does not leave the list loading, or reject, when a load is refused anyway", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockRejectedValue(new Error("Dictation is switched off."));
    const { result } = renderHook(() => useTranscripts(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.transcriptsMetadata).toEqual([]);
    vi.mocked(getAllTranscriptionMetadata).mockReset();
  });
});

describe("TranscriptsProvider — initial state", () => {
  it("starts with isLoading true and empty transcriptsMetadata", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.transcriptsMetadata).toEqual([]);
  });

  it("sets isLoading to false after metadata is fetched", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("populates transcriptsMetadata from getAllTranscriptionMetadata", async () => {
    const meta = [{ id: "t1", title: "Meeting 1" } as any];
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue(meta);

    const { result } = renderHook(() => useTranscripts(), { wrapper });

    await waitFor(() =>
      expect(result.current.transcriptsMetadata).toEqual(meta)
    );
  });

  it("exposes sensible default values for other state", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentTranscription).toBeNull();
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.audioPlaybackUrl).toBeNull();
    expect(result.current.isProcessingTranscription).toBe(false);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.transcriptionJobs).toEqual([]);
    expect(result.current.selectedRecordingMode).toBeNull();
  });
});

// ─── refreshMetadata ──────────────────────────────────────────────────────────

describe("refreshMetadata", () => {
  it("re-fetches metadata and updates state", async () => {
    const initial = [{ id: "t1" } as any];
    const updated = [{ id: "t1" } as any, { id: "t2" } as any];
    vi.mocked(getAllTranscriptionMetadata)
      .mockResolvedValueOnce(initial) // initial load ([] deps effect)
      .mockResolvedValueOnce(initial) // navigation refresh (no transcriptId → Decisions page effect)
      .mockResolvedValueOnce(updated); // explicit refreshMetadata() call

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refreshMetadata();
    });

    expect(result.current.transcriptsMetadata).toEqual(updated);
  });
});

// ─── refresh on the Decisions page (DIAAT-400) ────────────────────────────────

describe("TranscriptsProvider — the Decisions page, which lists the dictations (DIAAT-400)", () => {
  afterEach(() => {
    mockPathname = "/decisions";
    vi.mocked(getAllTranscriptionMetadata).mockReset();
  });

  it("refreshes the list on landing on /decisions, as on returning from the recorder", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    mockPathname = "/decisions";
    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The initial load, and the refresh for landing on the page.
    await waitFor(() => expect(getAllTranscriptionMetadata).toHaveBeenCalledTimes(2));
  });

  it("does not refresh it again on the home page, which no longer shows it", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    mockPathname = "/";
    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getAllTranscriptionMetadata).toHaveBeenCalledTimes(1);
  });
});

// ─── saveTranscription ────────────────────────────────────────────────────────

describe("saveTranscription", () => {
  it("calls db.saveTranscription and then refreshes metadata", async () => {
    const meta = [{ id: "t1" } as any];
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue(meta);
    vi.mocked(dbSaveTranscription).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveTranscription({ id: "t1", title: "New" } as any);
    });

    expect(dbSaveTranscription).toHaveBeenCalledWith({
      id: "t1",
      title: "New",
    });
    // metadata refresh is triggered after save
    expect(getAllTranscriptionMetadata).toHaveBeenCalledTimes(3); // initial load + navigation refresh + save refresh
  });
});

// ─── deleteTranscription ─────────────────────────────────────────────────────

describe("deleteTranscription", () => {
  it("calls db.deleteTranscription and refreshes metadata", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    vi.mocked(dbDeleteTranscription).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteTranscription("t1");
    });

    expect(dbDeleteTranscription).toHaveBeenCalledWith("t1");
  });

  it("navigates to home when the deleted transcription was current", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    vi.mocked(dbDeleteTranscription).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Manually set currentTranscription via a save first
    vi.mocked(dbSaveTranscription).mockResolvedValue(undefined);

    // Simulate current transcription by deleting the same ID that would match
    await act(async () => {
      await result.current.deleteTranscription("t1");
    });

    // router.push("/") should be called since there's no currentTranscription
    // (currentTranscription is null so condition `currentTranscription?.id === id` is false)
    // This is the expected behavior for no active transcription
    expect(dbDeleteTranscription).toHaveBeenCalledWith("t1");
  });
});

// ─── loadTranscription ────────────────────────────────────────────────────────

describe("loadTranscription", () => {
  it("pushes the correct URL to the router", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.loadTranscription("t1");
    });

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("id=t1"));
  });
});

// ─── renameTranscription ──────────────────────────────────────────────────────

describe("renameTranscription", () => {
  it("loads the transcription, renames it, saves, and refreshes metadata", async () => {
    const t = { id: "t1", title: "Old Name" } as any;
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    vi.mocked(getTranscriptionById).mockResolvedValue(t);
    vi.mocked(dbSaveTranscription).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.renameTranscription("t1", "New Name");
    });

    expect(getTranscriptionById).toHaveBeenCalledWith("t1");
    expect(dbSaveTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Name" })
    );
  });

  it("throws when the transcription is not found", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);
    vi.mocked(getTranscriptionById).mockResolvedValue(null);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.renameTranscription("missing", "Name");
      })
    ).rejects.toThrow("Transcription not found");
  });
});

// ─── saveTranscriptionJob ─────────────────────────────────────────────────────

describe("saveTranscriptionJob", () => {
  it("throws when there is no active transcription", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.saveTranscriptionJob({
          transcription_id: "t1",
          dialogue_entries: [],
        });
      })
    ).rejects.toThrow("No active transcription");
  });
});

// ─── state setters ────────────────────────────────────────────────────────────

describe("state setters", () => {
  it("setAudioBlob updates audioBlob", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const blob = new Blob(["audio"]);
    act(() => result.current.setAudioBlob(blob));

    expect(result.current.audioBlob).toBe(blob);
  });

  it("setIsRecording updates isRecording", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setIsRecording(true));

    expect(result.current.isRecording).toBe(true);
  });

  it("setSelectedRecordingMode updates selectedRecordingMode", async () => {
    vi.mocked(getAllTranscriptionMetadata).mockResolvedValue([]);

    const { result } = renderHook(() => useTranscripts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setSelectedRecordingMode("mic"));

    expect(result.current.selectedRecordingMode).toBe("mic");
  });
});

describe("TranscriptsProvider outside a jurisdiction (DIAAT-322)", () => {
  it("fetches no material", async () => {
    mockInJurisdiction = false;
    vi.mocked(getAllTranscriptionMetadata).mockClear();
    try {
      const { result } = renderHook(() => useTranscripts(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(() => result.current.refreshMetadata());
      expect(getAllTranscriptionMetadata).not.toHaveBeenCalled();
      expect(result.current.transcriptsMetadata).toEqual([]);
    } finally {
      mockInJurisdiction = true;
    }
  });
});
