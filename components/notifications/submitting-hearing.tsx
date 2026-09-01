"use client";

import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadTranscriptDocument } from "@/lib/download";

interface HearingSubmissionData {
  document_download_url?: string;
  transcription_id?: string;
  hearing_reference?: string;
  document_type?: string;
}

interface SubmitHearingToastContentProps {
  data: HearingSubmissionData;
}

const DURATION = Infinity;

export function SubmitHearingToastContent({
  data,
}: SubmitHearingToastContentProps) {
  const { transcription_id, hearing_reference, document_type } = data;

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <strong className="text-sm font-semibold">
            Hearing Submitted Successfully
          </strong>
        </div>
        {hearing_reference && (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{hearing_reference}</span>
          </p>
        )}
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="size-4 text-blue-600 dark:text-blue-400" />
            <span className="text-muted-foreground">
              {document_type || "Word Document"} generated and ready
            </span>
          </div>
          {transcription_id && (
            <Button
              size="sm"
              className="w-full! bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
              onClick={() => downloadTranscriptDocument(transcription_id)}
            >
              <Download className="size-4" />
              Download Document
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LoadingToastContent() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Submitting hearing...</span>
        <span className="text-xs text-muted-foreground">
          Generating your Word document
        </span>
      </div>
    </div>
  );
}

export default function submitHearingToast(
  submissionPromise: Promise<HearingSubmissionData>
) {
  return toast.promise(submissionPromise, {
    loading: <LoadingToastContent />,
    success: (data) => <SubmitHearingToastContent data={data} />,
    error: (error) => error.message || "Failed to save submission.",
    duration: DURATION,
  });
}
