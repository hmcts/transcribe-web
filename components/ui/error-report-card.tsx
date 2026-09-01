import * as Sentry from "@sentry/nextjs";
import { Copy } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { getDistinctId, track } from "@/lib/analytics";
import { getEnv } from "@/lib/env";

type ErrorReportInput = {
  title?: string;
  userEmail?: string | null;
  requestId?: string | null;
  sentryEventId?: string | null;
  sentryTraceId?: string | null;
  posthogDistinctId?: string | null;
  statusCode?: number | null;
  recordingMode?: "mic" | "screen" | "upload" | null;
  fileSizeBytes?: number | null;
  durationSeconds?: number | null;
  extra?: Record<string, unknown>;
  errorMessage?: string | null;
};

export default function ErrorReportCard({ data }: { data: ErrorReportInput }) {
  const report = React.useMemo(() => {
    const now = new Date().toISOString();
    const phid = getDistinctId();
    const sentryLastEvent = (Sentry as any)?.lastEventId?.() || null;
    return {
      title: data.title || "Judicial Transcribe Error Report",
      timestamp: now,
      location: typeof window !== "undefined" ? window.location.href : null,
      environment: process.env.NODE_ENV,
      apiBaseUrl: getEnv("NEXT_PUBLIC_API_URL"),
      user: { email: data.userEmail || null },
      observability: {
        sentry_event_id: data.sentryEventId || sentryLastEvent || null,
        sentry_trace_id: data.sentryTraceId || null,
        posthog_distinct_id: data.posthogDistinctId || phid,
      },
      backend: {
        request_id: data.requestId || null,
        status_code: data.statusCode ?? null,
      },
      recording: {
        mode: data.recordingMode || null,
        file_size_bytes: data.fileSizeBytes ?? null,
        duration_seconds: data.durationSeconds ?? null,
      },
      client: {
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        platform: typeof navigator !== "undefined" ? navigator.platform : null,
        language: typeof navigator !== "undefined" ? navigator.language : null,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
      },
      error_message: data.errorMessage || null,
      extra: data.extra || {},
    };
  }, [data]);

  const json = JSON.stringify(report, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      track("error_report_copied", {
        request_id: report.backend.request_id,
      });
    } catch (_e) {
      // noop
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `error-report-${report.backend.request_id || "unknown"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    track("error_report_downloaded", {
      request_id: report.backend.request_id,
    });
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Error report</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="mr-1 size-3" />
            Copy
          </Button>
          <Button size="sm" onClick={download}>
            Download JSON
          </Button>
        </div>
      </div>
      <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
        {json}
      </pre>
    </div>
  );
}
