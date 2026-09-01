"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Transcription, TranscriptionJob } from "@/src/api/generated";
import type { TranscriptionMetadata } from "@/src/api/generated/models/TranscriptionMetadata";
import { apiClient } from "../lib/api-client";
import {
  deleteTranscription,
  getAllTranscriptionMetadata,
  getTranscriptionById,
  getTranscriptionJobs,
  saveTranscription,
  saveTranscriptionJob,
} from "../lib/database";

interface TranscriptsContextType {
  transcriptsMetadata: TranscriptionMetadata[];
  currentTranscription: Transcription | null;
  saveTranscription: (transcription: Transcription) => void;
  loadTranscription: (id: string) => void;
  deleteTranscription: (id: string) => void;
  newTranscription: () => void;
  isLoading: boolean;
  audioBlob: Blob | null;
  setAudioBlob: (blob: Blob | null) => void;
  audioPlaybackUrl: string | null;
  setAudioPlaybackUrl: (url: string | null) => void;
  isProcessingTranscription: boolean;
  setIsProcessingTranscription: (isProcessing: boolean) => void;
  isRecording: boolean;
  setIsRecording: (isRecording: boolean) => void;
  renameTranscription: (id: string, newTitle: string) => Promise<void>;
  transcriptionJobs: TranscriptionJob[];
  saveTranscriptionJob: (job: TranscriptionJob) => Promise<TranscriptionJob>;
  selectedRecordingMode: "mic" | "screen" | "upload" | null;
  setSelectedRecordingMode: (mode: "mic" | "screen" | "upload" | null) => void;
  refreshMetadata: () => Promise<void>;
}

const TranscriptsContext = createContext<TranscriptsContextType | undefined>(
  undefined
);

export function TranscriptsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TranscriptsProviderContent>{children}</TranscriptsProviderContent>;
}

// Move the actual implementation to a separate component
function TranscriptsProviderContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [transcriptsMetadata, setTranscriptsMetadata] = useState<
    TranscriptionMetadata[]
  >([]);
  const [currentTranscription, setCurrentTranscription] =
    useState<Transcription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [isProcessingTranscription, setIsProcessingTranscription] =
    useState(false);
  const [isRecording, setIsRecording] = useState(false);
  // Tracks whether we already pushed a guard history entry for the current
  // blocking session so we don't push again on every isRecording state change.
  const hasNavGuardRef = useRef(false);
  const [transcriptionJobs, setTranscriptionJobs] = useState<
    TranscriptionJob[]
  >([]);
  const [selectedRecordingMode, setSelectedRecordingMode] = useState<
    "mic" | "screen" | "upload" | null
  >(null);
  const [pollingStartTime, setPollingStartTime] = useState<number | null>(null);

  // Get current values from URL
  const transcriptId = searchParams?.get("id");

  // Load transcription when ID in URL changes
  useEffect(() => {
    if (transcriptId) {
      const loadTranscription = async () => {
        try {
          const transcription = await getTranscriptionById(transcriptId);
          setCurrentTranscription(transcription);
          setAudioBlob(null);
          setAudioPlaybackUrl(null);
          setIsProcessingTranscription(false);
          setIsRecording(false);
        } catch (error) {
          console.error("Error loading transcription:", error);
          // Redirect to home if transcription not found
          router.push("/");
        }
      };

      loadTranscription();
    } else if (!transcriptId) {
      setCurrentTranscription(null);
    }
  }, [transcriptId, router]);

  // Function to refresh metadata - can be called manually or automatically
  const refreshMetadata = useCallback(async () => {
    try {
      const returnedMetadata = await getAllTranscriptionMetadata();
      setTranscriptsMetadata(returnedMetadata);
    } catch (error) {
      console.error("Failed to refresh metadata:", error);
    }
  }, []);

  // Initial load of metadata
  useEffect(() => {
    const loadMetadata = async () => {
      const returnedMetadata = await getAllTranscriptionMetadata();
      setTranscriptsMetadata(returnedMetadata);
      setIsLoading(false);
    };
    loadMetadata();
  }, []);

  // Auto-refresh metadata when tab gains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshMetadata();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshMetadata]);

  // Auto-refresh whenever we land on the home page.
  // This covers returning from the recorder, where transcriptId stays null
  // across the navigation from /record back to /.
  useEffect(() => {
    const isHomePage = pathname === "/";

    if (isHomePage && !transcriptId) {
      refreshMetadata();
      setPollingStartTime(Date.now());
    } else {
      setPollingStartTime(null);
    }
  }, [pathname, transcriptId, refreshMetadata]);

  // Poll for new recordings every 5 seconds for the first minute on home page
  useEffect(() => {
    if (!pollingStartTime || transcriptId) {
      return;
    }

    const POLLING_INTERVAL = 5000; // 5 seconds
    const POLLING_DURATION = 60000; // 1 minute

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - pollingStartTime;

      if (elapsed >= POLLING_DURATION) {
        // Stop polling after 1 minute
        setPollingStartTime(null);
        return;
      }

      refreshMetadata();
    }, POLLING_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [pollingStartTime, transcriptId, refreshMetadata]);

  // Add this effect to fetch transcription jobs when ID changes
  useEffect(() => {
    const loadTranscriptionJobs = async () => {
      if (!transcriptId) {
        setTranscriptionJobs([]);
        return;
      }

      try {
        const jobs = await getTranscriptionJobs(transcriptId);
        setTranscriptionJobs(jobs);
      } catch (error) {
        console.error("Failed to fetch transcription jobs:", error);
        setTranscriptionJobs([]);
      }
    };

    loadTranscriptionJobs();
  }, [transcriptId]);

  useEffect(() => {
    const fetchPlaybackUrl = async () => {
      setAudioPlaybackUrl(null);

      if (!currentTranscription?.id || transcriptionJobs.length === 0) {
        return;
      }

      const sortedJobs = [...transcriptionJobs].sort((a, b) => {
        const aDate = a.created_datetime
          ? new Date(a.created_datetime).getTime()
          : 0;
        const bDate = b.created_datetime
          ? new Date(b.created_datetime).getTime()
          : 0;
        return bDate - aDate;
      });

      const jobWithAudio = sortedJobs.find((job) => job.s3_audio_url && job.id);

      if (!jobWithAudio?.id) {
        return;
      }

      try {
        const response = await apiClient.getAudioPlaybackUrl(
          currentTranscription.id,
          jobWithAudio.id
        );

        if (response.data?.playback_url) {
          setAudioPlaybackUrl(response.data.playback_url);
        }
      } catch (error) {
        console.error("Failed to fetch audio playback URL:", error);
        setAudioPlaybackUrl(null);
      }
    };

    fetchPlaybackUrl();
  }, [currentTranscription?.id, transcriptionJobs]);

  const handleSaveTranscription = useCallback(
    async (transcription: Transcription) => {
      await saveTranscription(transcription);
      const returnedMetadata = await getAllTranscriptionMetadata();
      setTranscriptsMetadata(returnedMetadata);
    },
    []
  );

  const handleLoadTranscription = useCallback(
    async (id: string) => {
      // Update URL with transcription ID and reset stage
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("id", id);
      params.delete("stage"); // Reset to default stage
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const handleDeleteTranscription = useCallback(
    async (id: string) => {
      await deleteTranscription(id);
      const returnedMetadata = await getAllTranscriptionMetadata();
      setTranscriptsMetadata(returnedMetadata);

      // If current transcription was deleted, redirect to home
      if (currentTranscription?.id === id) {
        router.push("/");
      }
    },
    [currentTranscription, router]
  );

  const handleNewTranscription = useCallback(() => {
    // Clear URL params to create new transcription
    router.push(pathname || "");
    setAudioBlob(null);
    setAudioPlaybackUrl(null);
    setIsRecording(false);
  }, [pathname, router]);

  const handleRenameTranscription = useCallback(
    async (id: string, newTitle: string) => {
      // Load the full transcription
      const fullTranscription = await getTranscriptionById(id);
      if (!fullTranscription) {
        throw new Error("Transcription not found");
      }

      // Update and save
      fullTranscription.title = newTitle;
      await saveTranscription(fullTranscription);

      // Refresh metadata
      const returnedMetadata = await getAllTranscriptionMetadata();
      setTranscriptsMetadata(returnedMetadata);

      // Update current transcription if it's the one being renamed
      if (currentTranscription?.id === id) {
        setCurrentTranscription(fullTranscription);
      }
    },
    [currentTranscription]
  );

  const handleSaveTranscriptionJob = useCallback(
    async (job: TranscriptionJob) => {
      if (!currentTranscription?.id) {
        throw new Error("No active transcription");
      }

      const savedJob = await saveTranscriptionJob(currentTranscription.id, job);

      setTranscriptionJobs((prev) =>
        job.id
          ? prev.map((j) => (j.id === job.id ? savedJob : j))
          : [...prev, savedJob]
      );
      return savedJob;
    },
    [currentTranscription?.id]
  );

  // Add this useEffect for navigation prevention
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessingTranscription || isRecording) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    const handlePopState = (e: PopStateEvent) => {
      if (isProcessingTranscription || isRecording) {
        window.history.pushState(null, "", window.location.href);

        // eslint-disable-next-line no-alert
        const confirmNavigation = window.confirm(
          "You have an active recording or processing in progress. Are you sure you want to leave? Your progress will be lost."
        );

        if (!confirmNavigation) {
          e.preventDefault();
          window.history.pushState(null, "", window.location.href);
        }
      }
    };

    // Push a guard entry only when first entering a blocking state — not on
    // every re-run. The live-draft feature calls setIsRecording on every
    // recording-active change, which causes this effect to re-run repeatedly.
    // Calling pushState each time triggers Next.js App Router's history
    // interception, which can disrupt the Azure Speech SDK WebSocket session.
    const isBlocking = isProcessingTranscription || isRecording;
    if (isBlocking && !hasNavGuardRef.current) {
      window.history.pushState(null, "", window.location.href);
      hasNavGuardRef.current = true;
    } else if (!isBlocking) {
      hasNavGuardRef.current = false;
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isProcessingTranscription, isRecording]);

  const contextValue = useMemo(
    () => ({
      transcriptsMetadata,
      currentTranscription,
      saveTranscription: handleSaveTranscription,
      loadTranscription: handleLoadTranscription,
      deleteTranscription: handleDeleteTranscription,
      newTranscription: handleNewTranscription,
      isLoading,
      audioBlob,
      setAudioBlob,
      audioPlaybackUrl,
      setAudioPlaybackUrl,
      isProcessingTranscription,
      setIsProcessingTranscription,
      isRecording,
      setIsRecording,
      renameTranscription: handleRenameTranscription,
      transcriptionJobs,
      saveTranscriptionJob: handleSaveTranscriptionJob,
      selectedRecordingMode,
      setSelectedRecordingMode,
      refreshMetadata,
    }),
    [
      transcriptsMetadata,
      currentTranscription,
      handleSaveTranscription,
      handleLoadTranscription,
      handleDeleteTranscription,
      handleNewTranscription,
      isLoading,
      audioBlob,
      audioPlaybackUrl,
      isProcessingTranscription,
      isRecording,
      handleRenameTranscription,
      transcriptionJobs,
      handleSaveTranscriptionJob,
      selectedRecordingMode,
      refreshMetadata,
    ]
  );

  return (
    <TranscriptsContext.Provider value={contextValue}>
      {children}
    </TranscriptsContext.Provider>
  );
}

// Custom hook for using the transcription context
export function useTranscripts() {
  const context = useContext(TranscriptsContext);
  if (context === undefined) {
    throw new Error("useTranscripts must be used within a TranscriptsProvider");
  }
  return context;
}
