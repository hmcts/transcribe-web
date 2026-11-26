"use client";

import { useCallback, useEffect, useState } from "react";
import { HearingDetailView } from "@/components/recording/transcript/hearing-detail-view";
import { JobNotFound } from "@/components/recording/transcript/job-not-found";
import { apiPath } from "@/lib/recording/base-path";
import { recordingFetch } from "@/lib/recording/browser-fetch";
import type { Hearing } from "@/lib/recording/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "ready"; hearing: Hearing };

/**
 * A hearing's page, loaded in the browser (DIAAT-334): asked for in the tab's
 * own jurisdiction, so a hearing of another, even from a shared or bookmarked
 * link, is never shown. (The server, which has no tab, cannot know which to
 * ask in.) The id in the page's URL is the hearing's (DIAAT-428): for a
 * recording from before hearings, its own.
 */
export function HearingPage({ hearingId }: { hearingId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await recordingFetch(
        apiPath(`/api/hearings/${hearingId}`),
        { cache: "no-store" }
      );
      if (response.status === 404) {
        setState({ kind: "missing" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "failed" });
        return;
      }
      const body = await response.json();
      const hearing = body.hearing as Hearing;
      setState(
        hearing.days.length > 0
          ? { kind: "ready", hearing }
          : { kind: "missing" }
      );
    } catch {
      setState({ kind: "failed" });
    }
  }, [hearingId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "missing") return <JobNotFound />;
  if (state.kind === "failed") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">
          This recording could not be loaded
        </h1>
        <p className="text-muted-foreground">
          Check your connection, then try again.
        </p>
        <button
          type="button"
          className="rounded-md border px-4 py-2"
          onClick={() => void load()}
        >
          Try again
        </button>
      </main>
    );
  }
  if (state.kind === "loading") {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        aria-busy="true"
      >
        <p role="status" className="text-muted-foreground">
          Loading the recording...
        </p>
      </main>
    );
  }
  return <HearingDetailView initialHearing={state.hearing} />;
}
