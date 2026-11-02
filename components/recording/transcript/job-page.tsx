"use client";

import { useCallback, useEffect, useState } from "react";
import { JobDetailView } from "@/components/recording/transcript/job-detail-view";
import { JobNotFound } from "@/components/recording/transcript/job-not-found";
import { apiPath } from "@/lib/recording/base-path";
import { recordingFetch } from "@/lib/recording/browser-fetch";
import type { TranscriptionJob } from "@/lib/recording/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "ready"; job: TranscriptionJob };

/**
 * A job's page, loaded in the browser (DIAAT-334): asked for in the tab's own
 * jurisdiction, so a job of another, even from a shared or bookmarked link, is
 * never shown. (The server, which has no tab, cannot know which to ask in.)
 */
export function JobPage({ jobId }: { jobId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await recordingFetch(apiPath(`/api/jobs/${jobId}`), {
        cache: "no-store",
      });
      if (response.status === 404) {
        setState({ kind: "missing" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "failed" });
        return;
      }
      const body = await response.json();
      setState({ kind: "ready", job: body.job as TranscriptionJob });
    } catch {
      setState({ kind: "failed" });
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "missing") return <JobNotFound />;
  if (state.kind === "failed") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">This recording could not be loaded</h1>
        <p className="text-muted-foreground">Check your connection, then try again.</p>
        <button type="button" className="rounded-md border px-4 py-2" onClick={() => void load()}>
          Try again
        </button>
      </main>
    );
  }
  if (state.kind === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center" aria-busy="true">
        <p role="status" className="text-muted-foreground">
          Loading the recording...
        </p>
      </main>
    );
  }
  return <JobDetailView jobId={jobId} initialJob={state.job} />;
}
