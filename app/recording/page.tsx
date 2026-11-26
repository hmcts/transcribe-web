"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AudioUpload } from "@/components/recording/audio-upload/audio-upload";
import { FilterableJobsSection } from "@/components/recording/jobs-table/filterable-jobs-section";
import { apiPath } from "@/lib/recording/base-path";
import { type HearingRow, hearingRow } from "@/lib/recording/hearing-rows";
import type { HearingSummary } from "@/lib/recording/types";
import { uploadRecording } from "@/lib/recording/upload-recording";
import { recordingFetch } from "@/lib/recording/browser-fetch";
import {
  JurisdictionSwitchError,
  onBeforeJurisdictionSwitch,
} from "@/lib/jurisdiction-switch";
import { useMultiDayHearings } from "@/providers/runtime-flags";

const POLL_INTERVAL_MS = 5000;

// DIAAT-428: one row per hearing, whatever its number of days.
async function fetchJobs(): Promise<HearingRow[]> {
  const response = await recordingFetch(apiPath("/api/hearings"), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to load hearings: ${response.status}`);
  }
  const body = await response.json();
  return (body.hearings as HearingSummary[])
    .filter((hearing) => hearing.days.length > 0)
    .map(hearingRow);
}

export default function DashboardPage() {
  const multiDayHearings = useMultiDayHearings();
  const [jobs, setJobs] = useState<HearingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // Read inside the interval tick rather than as an effect dependency, so a
  // single interval lives for the component's lifetime instead of being
  // torn down and recreated on every job list update.
  const jobsRef = useRef<HearingRow[]>(jobs);
  jobsRef.current = jobs;

  const refresh = useCallback(async () => {
    try {
      setJobs(await fetchJobs());
    } catch (err) {
      console.error(err);
      toast.error("Could not load transcription jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any job is still in flight; stop refetching as soon as
  // everything has reached a terminal state so the dashboard doesn't poll
  // forever.
  useEffect(() => {
    const id = setInterval(() => {
      const hasActiveJobs = jobsRef.current.some(
        (job) => job.status === "PENDING" || job.status === "PROCESSING"
      );
      if (hasActiveJobs) refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // DIAAT-332: a switch reloads the tab, which would cancel an upload in progress.
  const uploadingRef = useRef(false);
  uploadingRef.current = uploading;
  useEffect(
    () =>
      onBeforeJurisdictionSwitch(async () => {
        if (uploadingRef.current) throw new JurisdictionSwitchError("busy");
      }),
    []
  );

  const handleUpload = useCallback(
    async (file: File, hearingDate?: string) => {
      setUploading(true);
      try {
        await uploadRecording(file, { hearingDate });
        toast.success(`"${file.name}" submitted for transcription`);
        await refresh();
      } catch (err) {
        console.error(err);
        toast.error(
          err instanceof Error ? err.message : "Failed to submit audio file"
        );
      } finally {
        setUploading(false);
      }
    },
    [refresh]
  );

  const handleDelete = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">
            Batch Audio Transcription
          </h1>
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            Beta
          </span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        {/* Upload section */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Upload audio file</h2>
          <div className="max-w-xl">
            <AudioUpload
              onUpload={handleUpload}
              uploading={uploading}
              askHearingDate={multiDayHearings}
            />
          </div>
        </section>

        {/* Transcripts: completed jobs only, ready to open */}
        {loading ? (
          <section>
            <h2 className="text-lg font-semibold mb-4">Transcripts</h2>
            <p className="text-muted-foreground">Loading…</p>
          </section>
        ) : (
          <FilterableJobsSection
            title="Transcripts"
            jobs={completedJobs}
            onDelete={handleDelete}
          />
        )}

        {/* Uploads: every job regardless of status — full history */}
        <FilterableJobsSection
          title="Uploads"
          jobs={jobs}
          onDelete={handleDelete}
        />
      </div>
    </main>
  );
}
