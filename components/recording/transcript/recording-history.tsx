"use client";

import { ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";
import {
  describeHistoryAction,
  describeOutcome,
  HISTORY_PAGE_SIZE,
  type HistoryPage,
} from "@/lib/recording/history";
import { apiPath } from "@/lib/recording/base-path";
import { recordingFetch } from "@/lib/recording/browser-fetch";
import { cn } from "@/lib/recording/utils";
import { roleLabel } from "@/lib/access/types";
import { useAccess } from "@/providers/access";

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * "History" of a recording (DIAAT-395): everything that was done to it, by whom,
 * in which role. It is the audit trail, separate from the per-segment edit history
 * in the transcript (which it does not replace or touch), and shown only to a
 * context that holds `recording.audit.read`: the API refuses anyone else, and the
 * web does not ask.
 */
export function RecordingHistory({ jobId }: { jobId: string }) {
  const { can } = useAccess();
  if (!can("recording.audit.read")) return null;
  return <HistorySection jobId={jobId} />;
}

function HistorySection({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError(null);
    recordingFetch(
      apiPath(
        `/api/jobs/${encodeURIComponent(jobId)}/history?page=${page}&page_size=${HISTORY_PAGE_SIZE}`
      )
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "The history is not available for this recording."
              : "The history could not be loaded. Try again."
          );
        }
        return (await response.json()) as HistoryPage;
      })
      .then((result) => current && setData(result))
      .catch((err) => current && setError(err instanceof Error ? err.message : "The history could not be loaded."))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [open, jobId, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / HISTORY_PAGE_SIZE)) : 1;

  return (
    <section className="mt-8" aria-labelledby="recording-history-toggle">
      <button
        id="recording-history-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-lg font-semibold hover:text-primary"
      >
        <History className="size-5" />
        History
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-3">
          <p className="mb-3 text-sm text-muted-foreground">
            Everything done to this recording: who did it, in which role, and when,
            newest first. It does not show any of the transcript.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : !data ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the history...
            </p>
          ) : data.items.length === 0 ? (
            <p className="rounded-lg border border-border py-6 text-center text-sm text-muted-foreground">
              Nothing has been recorded for this recording yet.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm" aria-busy={loading}>
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left">
                      <th className="px-3 py-2 font-medium">When</th>
                      <th className="px-3 py-2 font-medium">What</th>
                      <th className="px-3 py-2 font-medium">Who</th>
                      <th className="px-3 py-2 font-medium">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-3 py-2">
                          {formatTimestamp(entry.timestamp)}
                        </td>
                        <td className="px-3 py-2">
                          {describeHistoryAction(entry.action)}
                        </td>
                        <td className="px-3 py-2">
                          {entry.actor_label}
                          {entry.actor_role && (
                            <span className="block text-xs text-muted-foreground">
                              as {roleLabel(entry.actor_role).toLowerCase()}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {describeOutcome(entry.outcome)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Page {page} of {pages}
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md border px-3 py-1 disabled:opacity-50"
                      disabled={loading || page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="rounded-md border px-3 py-1 disabled:opacity-50"
                      disabled={loading || page >= pages}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
